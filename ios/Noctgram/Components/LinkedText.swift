import SwiftUI

/// Text with tappable mentions, tags and links. Taps go through the app's
/// OpenURLAction (see RootView).
struct LinkedText: View {
    @EnvironmentObject private var session: AppSession
    let text: String
    var size: CGFloat = 15
    var color: Color = Noct.text75
    var lineSpacing: CGFloat = 4

    var body: some View {
        Text(RichText.attributed(text, baseURL: session.api.baseURL))
            .font(.system(size: size))
            .foregroundColor(color)
            .lineSpacing(lineSpacing)
            .tint(.white)
            .fixedSize(horizontal: false, vertical: true)
    }
}
