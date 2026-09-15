# NoctGram for iPhone

SwiftUI client for the existing NoctGram account and server at https://noctgram.com. iOS 15 or later. A SwiftUI App and WindowGroup own the window, safe areas and scene lifecycle used by chat polling. The earlier WKWebView implementation remains in the source tree, but is not the application entry point. This release is for registered test devices.

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

Version 1.1 includes email-code sign-in, onboarding, feed/search/following/saved views, publications with media, likes and comments, profiles and editing, received gifts and the existing Stars wallet, personal/group conversations, replies, reactions, archive, group discovery and in-app events. The shared community group comes from the same server list as the website. Camera capture, music-provider integration, stories and advanced creator/admin tools are not included yet.

Personal messages support photos, videos and documents through the authenticated API. The main-branch group API currently accepts text only; this client does not bypass that restriction. Media files are downloaded with bounded size, stored temporarily with file protection and removed when their viewer closes or the account signs out. Photo/document pickers and media playback use native system components.

The private ephemeral URLSession cookie jar persists session credentials in Keychain (WhenUnlockedThisDeviceOnly), never UserDefaults. API redirects are restricted to the exact HTTPS origin. Sign out cancels pending requests and clears credentials/cache. Safari/WKWebView sessions are not imported: use the email linked to your NoctGram account to sign in once.

On iOS 26, system navigation uses Liquid Glass and selected action panels use glassEffect. Earlier systems use materials. Reduce Transparency uses opaque controls. Content cards stay opaque for readability; fonts use Dynamic Type and controls provide VoiceOver labels.

No server migration is required for this feature set. Server balances, permissions and moderation remain authoritative. There are no seeded gifts/balances and no automatic purchases. This first native release does not yet match every web feature: APNs notifications, PushKit/CallKit background calls, compatible secret-chat encryption/key transfer and an App Store submission remain separate work. Secret chats never fall back to plaintext.

## Native checks

The workflow runs on macOS 26 with Xcode 26 or newer. No personal Mac is needed. NoctGramTests checks API decoding, request restrictions, uploads, cookies and errors with an injected URLProtocol. NoctGramUITests checks native login and validation, and captures a screenshot. Tests never request email codes, send production messages or spend Stars. The login launch flag is compiled only in Debug and never creates an authenticated session. NoctGram-native-checks contains simulator diagnostics and a preview; artifacts expire after seven days.

A build and simulator checks do not prove authenticated behavior on the physical iPhone. Check login and second launch, keyboard/reply gestures, a photo in a test conversation, profiles/gifts and logout. This release replaces the earlier wrapper when installed with the same profile/bundle ID.

## APNs prerequisite

The supplied profile permits production push, but the distribution .p12 is not a server APNs credential. The Apple Developer account owner must supply an APNs key or provider certificate, and the server needs authenticated device registration and delivery. VoIP pushes require CallKit and must represent real incoming calls. The app does not request notification permission before that service is available.

References: [Apple: adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass), [Apple: responding to VoIP notifications](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit).
