import UIKit
import SwiftUI

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.overrideUserInterfaceStyle = .dark
        window.backgroundColor = .black
        window.rootViewController = UIHostingController(rootView: NativeRootView())
        self.window = window
        window.makeKeyAndVisible()
        return true
    }
}
