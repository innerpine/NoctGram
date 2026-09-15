"""Archive, sign and export NoctGram without logging signing material."""
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone

SOURCE = Path(__file__).resolve().parents[1]
TEMP = Path(os.environ['RUNNER_TEMP']).resolve()
WORK = TEMP / ('noctgram-ios-' + os.environ.get('GITHUB_RUN_ID', 'local'))
OUTPUT = Path(os.environ.get('NOCT_IOS_OUTPUT', str(SOURCE / 'build'))).resolve()
KEYCHAIN = WORK / 'signing.keychain-db'
KEYCHAIN_PASSWORD = secrets.token_urlsafe(32)
PROFILE_COPY = None
SENSITIVE = []


def run(args, label, *, private=False):
    result = subprocess.run([str(arg) for arg in args], cwd=SOURCE, capture_output=True)
    if result.returncode:
        if private and label == 'Import signing identity':
            diagnostic = result.stderr.decode('utf-8', errors='replace').strip()
            for value in [str(arg) for arg in args if len(str(arg)) > 3] + SENSITIVE:
                diagnostic = diagnostic.replace(value, '[redacted]')
            print('Signing import diagnostic: ' + diagnostic[-500:])
        if not private:
            log = (result.stdout + result.stderr).decode('utf-8', errors='replace')
            for value in SENSITIVE:
                if value:
                    log = log.replace(value, '[redacted]')
            print('\n'.join(log.splitlines()[-100:]))
        raise RuntimeError(label + ' failed.')
    return result.stdout


def main():
    global PROFILE_COPY
    WORK.mkdir(parents=True, exist_ok=False)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    certificate = WORK / 'identity.p12'
    profile = WORK / 'profile.mobileprovision'
    certificate.write_bytes(base64.b64decode(os.environ['NOCT_IOS_CERTIFICATE_P12'], validate=True))
    profile.write_bytes(base64.b64decode(os.environ['NOCT_IOS_PROFILE'], validate=True))
    password = os.environ['NOCT_IOS_P12_PASSWORD']
    SENSITIVE.extend([str(WORK), KEYCHAIN_PASSWORD])
    decoded = run(['security', 'cms', '-D', '-i', profile], 'Profile decode', private=True)
    data = plistlib.loads(decoded)
    entitlements = data['Entitlements']
    team = data['TeamIdentifier'][0]
    prefix = data.get('ApplicationIdentifierPrefix', [team])[0]
    app_identifier = entitlements['application-identifier']
    if not app_identifier.startswith(prefix + '.'):
        raise RuntimeError('Profile app prefix mismatch.')
    bundle = app_identifier[len(prefix) + 1:]
    if bundle == '*':
        bundle = 'com.noctgram.ios'
    elif bundle.endswith('.*'):
        bundle = bundle[:-1] + 'noctgram'
    if not re.fullmatch(r'[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', bundle):
        raise RuntimeError('Invalid application identifier in profile.')
    if not re.fullmatch(r'[A-Z0-9]{10}', team):
        raise RuntimeError('Invalid team identifier in profile.')
    now = datetime.now(timezone.utc)
    if data['ExpirationDate'].replace(tzinfo=timezone.utc) <= now:
        raise RuntimeError('Provisioning profile has expired.')
    if data.get('CreationDate', datetime.min).replace(tzinfo=timezone.utc) > now:
        raise RuntimeError('Provisioning profile is not valid yet.')
    devices = data.get('ProvisionedDevices', [])
    if not devices or data.get('ProvisionsAllDevices'):
        raise RuntimeError('This build requires a profile for registered iPhones.')
    profile_id = data['UUID']
    if not re.fullmatch(r'[A-Fa-f0-9-]{36}', profile_id):
        raise RuntimeError('Invalid provisioning profile identifier.')
    SENSITIVE.extend(devices + [data.get('Name', ''), profile_id])
    method = 'debugging' if entitlements.get('get-task-allow') else 'release-testing'
    fingerprint_allowlist = {hashlib.sha1(cert).hexdigest().upper() for cert in data['DeveloperCertificates']}

    run(['security', 'create-keychain', '-p', KEYCHAIN_PASSWORD, KEYCHAIN], 'Create keychain', private=True)
    run(['security', 'set-keychain-settings', '-lut', '3600', KEYCHAIN], 'Keychain timeout', private=True)
    run(['security', 'unlock-keychain', '-p', KEYCHAIN_PASSWORD, KEYCHAIN], 'Unlock keychain', private=True)
    run(['security', 'import', certificate, '-P', password, '-A', '-t', 'cert', '-f', 'pkcs12', '-k', KEYCHAIN], 'Import signing identity', private=True)
    run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-k', KEYCHAIN_PASSWORD, KEYCHAIN], 'Signing ACL', private=True)
    run(['security', 'list-keychains', '-d', 'user', '-s', KEYCHAIN], 'Signing keychain', private=True)
    identities = run(['security', 'find-identity', '-v', '-p', 'codesigning', KEYCHAIN], 'Read identity', private=True).decode()
    fingerprints = set(re.findall(r'\b[0-9A-F]{40}\b', identities))
    matching = fingerprints & fingerprint_allowlist
    if len(matching) != 1:
        raise RuntimeError('No unique valid signing identity matches this profile.')
    identity = matching.pop()
    profile_dir = Path.home() / 'Library/MobileDevice/Provisioning Profiles'
    profile_dir.mkdir(parents=True, exist_ok=True)
    PROFILE_COPY = profile_dir / (profile_id + '.mobileprovision')
    shutil.copyfile(profile, PROFILE_COPY)
    # Recent Xcode versions search this path as well.
    xcode_profiles = Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles'
    xcode_profiles.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(profile, xcode_profiles / PROFILE_COPY.name)

    run(['xcodegen', 'generate', '--spec', SOURCE / 'project.yml'], 'Project generation')
    archive = WORK / 'NoctGram.xcarchive'
    run(['xcodebuild', '-quiet', '-project', SOURCE / 'NoctGram.xcodeproj', '-scheme', 'NoctGram', '-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', archive, '-derivedDataPath', WORK / 'DerivedData', 'archive', 'CODE_SIGN_STYLE=Manual', 'DEVELOPMENT_TEAM=' + team, 'PRODUCT_BUNDLE_IDENTIFIER=' + bundle, 'PROVISIONING_PROFILE_SPECIFIER=' + profile_id, 'CODE_SIGN_IDENTITY=' + identity, 'CURRENT_PROJECT_VERSION=' + os.environ.get('GITHUB_RUN_NUMBER', '1')], 'Xcode archive')
    export = {'method': method, 'teamID': team, 'signingStyle': 'manual', 'signingCertificate': identity, 'provisioningProfiles': {bundle: profile_id}, 'stripSwiftSymbols': True, 'manageAppVersionAndBuildNumber': False, 'thinning': '<none>'}
    options = WORK / 'ExportOptions.plist'
    options.write_bytes(plistlib.dumps(export))
    run(['xcodebuild', '-quiet', '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', WORK / 'export'], 'IPA export')
    ipas = list((WORK / 'export').glob('*.ipa'))
    if len(ipas) != 1:
        raise RuntimeError('Expected one exported IPA.')
    import zipfile
    verified = WORK / 'verification'
    with zipfile.ZipFile(ipas[0]) as z:
        z.extractall(verified)
    app = next((verified / 'Payload').glob('*.app'))
    run(['codesign', '--verify', '--deep', '--strict', app], 'Signature verification', private=True)
    app_info = plistlib.loads((app / 'Info.plist').read_bytes())
    if app_info['CFBundleIdentifier'] != bundle:
        raise RuntimeError('Exported application identifier mismatch.')
    embedded = plistlib.loads(run(['security', 'cms', '-D', '-i', app / 'embedded.mobileprovision'], 'Embedded profile', private=True))
    if embedded['UUID'] != profile_id:
        raise RuntimeError('Exported provisioning profile mismatch.')
    destination = OUTPUT / 'NoctGram.ipa'
    shutil.copyfile(ipas[0], destination)
    info = {'app': 'NoctGram', 'site': 'https://noctgram.com', 'bundleId': bundle, 'build': app_info['CFBundleVersion'], 'method': method, 'profileExpires': data['ExpirationDate'].isoformat(), 'registeredDeviceCount': len(devices), 'commit': os.environ.get('GITHUB_SHA'), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'deviceTested': False}
    (OUTPUT / 'BUILD-INFO.txt').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Signed NoctGram.ipa exported and verified. Physical iPhone testing is still required.')


try:
    main()
except Exception as error:
    # Never print subprocess arguments or signing contents on failures.
    print('::error::' + (str(error) if isinstance(error, RuntimeError) else 'Build configuration or signing material could not be processed.'))
    sys.exit(1)
finally:
    if KEYCHAIN.exists():
        subprocess.run(['security', 'delete-keychain', str(KEYCHAIN)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if PROFILE_COPY:
        PROFILE_COPY.unlink(missing_ok=True)
        (Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles' / PROFILE_COPY.name).unlink(missing_ok=True)
    if WORK.parent.resolve() == TEMP and WORK.name.startswith('noctgram-ios-'):
        shutil.rmtree(WORK, ignore_errors=True)
