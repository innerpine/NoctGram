import SwiftUI

@main
struct NoctgramApp: App {
    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                VStack(spacing: 16) {
                    Image("Logo").resizable().scaledToFit().frame(width: 96, height: 96)
                    Text("noctgram").font(.system(size: 28, weight: .semibold)).foregroundColor(.white)
                }
            }
            .preferredColorScheme(.dark)
        }
    }
}
