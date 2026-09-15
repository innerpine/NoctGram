import SwiftUI

@main
struct NoctGramApp: App {
    var body: some Scene {
        // SwiftUI owns the scene so foreground state and safe areas reach every screen.
        WindowGroup {
            NativeRootView()
        }
    }
}
