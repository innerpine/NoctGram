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
device = phones[0]['udid']
result = temp / 'noctgram-native-tests.xcresult'
derived = temp / 'noctgram-native-tests-derived'
command = ['xcodebuild', '-quiet', '-project', str(source / 'NoctGram.xcodeproj'), '-scheme', 'NoctGram',
           '-configuration', 'Debug', '-destination', 'platform=iOS Simulator,id=' + device,
           '-derivedDataPath', str(derived), '-resultBundlePath', str(result),
           '-parallel-testing-enabled', 'NO', 'test', 'CODE_SIGNING_ALLOWED=NO']
completed = subprocess.run(command, cwd=source)
if completed.returncode:
    raise SystemExit(completed.returncode)
app = derived / 'Build/Products/Debug-iphonesimulator/NoctGram.app'
subprocess.run(['xcrun', 'simctl', 'install', device, str(app)], check=True)
subprocess.run(['xcrun', 'simctl', 'launch', device, 'com.noctgram.ios', '--ui-test-login'], check=True)
# The UI test above already asserts initial rendering; capture a standalone review image too.
import time
time.sleep(3)
subprocess.run(['xcrun', 'simctl', 'io', device, 'screenshot', str(temp / 'noctgram-native-preview.png')], check=True)
