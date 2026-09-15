"""Run native tests on an available iPhone simulator, with no signing credentials."""
import json
import os
from pathlib import Path
import subprocess

source = Path(__file__).resolve().parents[1]
temp = Path(os.environ['RUNNER_TEMP'])
subprocess.run(['xcodegen', 'generate', '--spec', str(source / 'project.yml')], cwd=source, check=True)
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))
phones = [d for runtime, rows in devices['devices'].items() if 'iOS' in runtime
          for d in rows if 'iPhone' in d['name'] and d.get('isAvailable')]
if not phones:
    raise RuntimeError('No iPhone simulator is installed on the runner.')
# Match the reported device when available; other installed iPhones remain a usable fallback.
device = next((phone for phone in phones if phone['name'] == 'iPhone 17 Pro'), phones[0])['udid']
result = temp / 'noctgram-native-tests.xcresult'
derived = temp / 'noctgram-native-tests-derived'
command = ['xcodebuild', '-quiet', '-project', str(source / 'NoctGram.xcodeproj'), '-scheme', 'NoctGram',
           '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + device,
           '-derivedDataPath', str(derived), '-resultBundlePath', str(result),
           '-parallel-testing-enabled', 'NO', 'test', 'CODE_SIGNING_ALLOWED=YES',
           'CODE_SIGN_IDENTITY=-', 'CODE_SIGN_STYLE=Manual',
           'DEVELOPMENT_TEAM=', 'PROVISIONING_PROFILE_SPECIFIER=']
completed = subprocess.run(command, cwd=source)
if result.exists():
    report = subprocess.run(['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(result)], capture_output=True, text=True)
    if report.returncode == 0:
        (temp / 'noctgram-native-summary.json').write_text(report.stdout, encoding='utf-8')
        print(report.stdout)
    # Keep actual test screenshots (feed, chats and keyboard), including failed-run evidence.
    review = temp / 'noctgram-native-review'
    exported = subprocess.run(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', str(result),
                               '--output-path', str(review)], capture_output=True, text=True)
    if exported.returncode:
        print('Attachment export unavailable; screenshots remain in the xcresult bundle:', exported.stderr)
if completed.returncode:
    raise SystemExit(completed.returncode)
app = derived / 'Build/Products/Debug-iphonesimulator/NoctGram.app'
subprocess.run(['xcrun', 'simctl', 'boot', device], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
subprocess.run(['xcrun', 'simctl', 'bootstatus', device, '-b'], check=True)
subprocess.run(['xcrun', 'simctl', 'install', device, str(app)], check=True)
subprocess.run(['xcrun', 'simctl', 'launch', device, 'com.noctgram.ios', '--ui-test-login'], check=True)
# The UI test above already asserts initial rendering; capture a standalone review image too.
import time
time.sleep(3)
subprocess.run(['xcrun', 'simctl', 'io', device, 'screenshot', str(temp / 'noctgram-native-preview.png')], check=True)
subprocess.run(['xcrun', 'simctl', 'terminate', device, 'com.noctgram.ios'], check=True)
subprocess.run(['xcrun', 'simctl', 'launch', device, 'com.noctgram.ios', '--ui-test-social'], check=True)
time.sleep(3)
subprocess.run(['xcrun', 'simctl', 'io', device, 'screenshot', str(temp / 'noctgram-native-feed-preview.png')], check=True)
