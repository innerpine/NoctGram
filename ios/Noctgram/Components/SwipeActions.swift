import SwiftUI
import UIKit

/// A button a row reveals when swiped to the left, as in Telegram: a round
/// coloured button with its title under it.
struct SwipeAction: Identifiable {
    let title: String
    let icon: String
    let color: Color
    let run: () -> Void

    var id: String { title }
}

/// A row that slides to the left to show its actions, as chats do in
/// Telegram. The list keeps which row is open (one at a time); a tap on the
/// open row or a swipe back closes it. From iOS 18 a UIKit pan that starts
/// only on a sideways pull, so the list keeps scrolling (a SwiftUI drag
/// inside a ScrollView stops it on iOS 26). VoiceOver gets the actions too.
struct SwipeActionsRow<Content: View>: View {
    let actions: [SwipeAction]
    @Binding var open: Bool
    @ViewBuilder let content: () -> Content
    @State private var drag: CGFloat = 0

    private let slot: CGFloat = 72

    private var width: CGFloat { CGFloat(actions.count) * slot + 12 }

    private var offset: CGFloat {
        let raw = (open ? -width : 0) + drag
        // Past its buttons the row stretches.
        return raw < -width ? -width + (raw + width) * 0.3 : min(0, raw)
    }

    private var progress: CGFloat { min(1, -offset / width) }

    var body: some View {
        ZStack(alignment: .trailing) {
            buttons
            content()
                .background {
                    RoundedRectangle(cornerRadius: 26, style: .continuous)
                        .fill(Noct.card)
                        .opacity(progress > 0 ? 1 : 0)
                }
                .overlay {
                    if open {
                        // An open row closes on a tap instead of opening the
                        // chat; it moves with the row, so the buttons stay free.
                        Color.clear
                            .contentShape(Rectangle())
                            .onTapGesture { close() }
                    }
                }
                .offset(x: offset)
                .modifier(RevealGesture(open: open, changed: { drag = $0 }, ended: finish))
                .accessibilityActions {
                    ForEach(actions) { action in
                        Button(action.title, action: action.run)
                    }
                }
        }
    }

    private var buttons: some View {
        HStack(spacing: 0) {
            ForEach(actions) { action in
                Button {
                    close()
                    action.run()
                } label: {
                    VStack(spacing: 6) {
                        Image(systemName: action.icon)
                            .font(.system(size: 21, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: 54, height: 54)
                            .background(Circle().fill(action.color))
                        Text(action.title)
                            .font(.system(size: 12))
                            .foregroundColor(Noct.text75)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    .frame(width: slot)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel(action.title)
                .accessibilityIdentifier("swipe-" + action.title)
                .accessibilityHidden(!open)
            }
        }
        .padding(.trailing, 6)
        .scaleEffect(0.6 + 0.4 * progress, anchor: .trailing)
        .opacity(Double(progress))
        .allowsHitTesting(open)
    }

    private func close() {
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            drag = 0
            open = false
        }
    }

    /// Opens past 40 % of the buttons or on a flick to the left; closes the
    /// same way to the right.
    private func finish(_ distance: CGFloat, _ speed: CGFloat) {
        let target = open
            ? !(distance > width * 0.35 || speed > 400)
            : (distance < -width * 0.4 || speed < -500)
        withAnimation(.spring(response: 0.32, dampingFraction: 0.86)) {
            drag = 0
            open = target
        }
    }
}

private struct RevealGesture: ViewModifier {
    let open: Bool
    let changed: (CGFloat) -> Void
    let ended: (CGFloat, CGFloat) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(RevealPan(open: open, changed: changed, ended: ended))
        } else {
            content.simultaneousGesture(
                DragGesture(minimumDistance: 14)
                    .onChanged { value in
                        let dx = value.translation.width, dy = value.translation.height
                        guard abs(dx) > abs(dy) * 1.2, dx < 0 || open else { return }
                        changed(dx)
                    }
                    .onEnded { value in
                        let dx = value.translation.width, dy = value.translation.height
                        guard abs(dx) > abs(dy) * 1.2, dx < 0 || open else {
                            ended(0, 0)
                            return
                        }
                        ended(dx, value.predictedEndTranslation.width - dx)
                    }
            )
        }
    }
}

/// A pan that begins only when the finger moves sideways more than up or
/// down: to the left, or to the right on an open row. The list waits for
/// it to fail before it scrolls.
@available(iOS 18.0, *)
private struct RevealPan: UIGestureRecognizerRepresentable {
    let open: Bool
    let changed: (CGFloat) -> Void
    /// The distance pulled and the speed at the end.
    let ended: (CGFloat, CGFloat) -> Void

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }

    func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) {
        context.coordinator.open = open
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        let dx = pan.translation(in: pan.view).x
        switch pan.state {
        case .began, .changed: changed(dx)
        case .ended: ended(dx, pan.velocity(in: pan.view).x)
        case .cancelled, .failed: ended(0, 0)
        default: break
        }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var open = false

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            var way = pan.translation(in: pan.view)
            if way == .zero { way = pan.velocity(in: pan.view) }
            return abs(way.x) > abs(way.y) * 1.2 && (way.x < 0 || open)
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            other.view is UIScrollView
        }
    }
}
