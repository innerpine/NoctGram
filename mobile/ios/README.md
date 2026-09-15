# NoctGram for iPhone

Native UIKit/WKWebView client for https://noctgram.com, built with Xcode on a GitHub-hosted macOS runner. The website, API and database remain on the existing server. This first version is for installing on registered test devices.

## Build

1. Place the Apple PKCS#12 signing identity and matching ad hoc/development profile in the `noctgram-ios` GitHub environment secrets:
   - `NOCT_IOS_CERTIFICATE_P12`: base64 of the .p12 file.
   - `NOCT_IOS_PROFILE`: base64 of the .mobileprovision file.
   - `NOCT_IOS_P12_PASSWORD`: password of the .p12 file.
2. Run the **Build NoctGram IPA** workflow. It runs on pushes to `markdev/noctgram-ios-*` that change this directory or the workflow, and supports manual dispatch once present in the default branch. Environment branch rules must allow the exact trusted build branch.
3. Download the `NoctGram-iPhone` artifact. It contains the signed .ipa and BUILD-INFO.txt. It contains no private key or certificate password.
4. Install the .ipa on an iPhone included in the profile using your usual IPA installer. The installed app is named NoctGram. The bundle identifier is taken from the profile; an existing app with that same identifier would be replaced.

XcodeGen generates the project from project.yml. For a local Mac build use `xcodegen generate --spec mobile/ios/project.yml`, open the generated project, and choose your signing identity/profile. CI validates the profile, imports the identity into a temporary keychain, archives and exports for registered devices, then verifies the exported app signature. Secrets and keychain are removed at the end.

## Included

Persistent login, the current NoctGram web UI, safe area, inline media, camera/microphone prompts, external Telegram links, download/share handling and a retry screen when the network fails. The interface receives website updates from noctgram.com without rebuilding the wrapper.

Native APNs notifications, PushKit/CallKit background calls and an App Store submission are separate work. A signed build does not prove behavior on a physical iPhone: check login, keyboard, attachments, audio calls, payments and any music-provider OAuth on your device before sharing it more broadly. Safari and WKWebView do not share all session cookies.
