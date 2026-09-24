import SwiftUI
import UIKit

/// One action under a held message.
struct MessageAction: Identifiable {
    let id = UUID()
    let title: String
    let icon: String
    var destructive = false
    let run: () -> Void
}

/// A held message shown alone over the blurred screen, reactions above and
/// actions below, as in Telegram. RootView draws it above the bars.
@MainActor
final class MessageFocus: ObservableObject {
    struct Item {
        /// The bubble's frame on screen when it was held.
        let frame: CGRect
        let mine: Bool
        let bubble: AnyView
        /// Emoji to offer; empty when reactions are unavailable.
        let reactions: [String]
        let chosen: String?
        let actions: [MessageAction]
        /// Called with the picked emoji, or nil to take the reaction back.
        let react: (String?) -> Void
    }

    @Published private(set) var item: Item?

    func present(_ item: Item) {
        // The keyboard would cover the actions of a message low on screen.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        self.item = item
    }

    func dismiss() {
        item = nil
    }
}

struct MessageFocusView: View {
    let item: MessageFocus.Item
    let close: () -> Void
    @State private var shown = false

    private let rowHeight: CGFloat = 46
    private let gap: CGFloat = 8
    private let menuWidth: CGFloat = 250

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let insets = ScreenInsets.current
            let cell = min(44, (size.width - 16 - 12 - CGFloat(max(0, item.reactions.count - 1)) * 2) / CGFloat(max(1, item.reactions.count)))
            let barWidth = CGFloat(item.reactions.count) * cell + CGFloat(max(0, item.reactions.count - 1)) * 2 + 12
            let barHeight: CGFloat = item.reactions.isEmpty ? 0 : cell + 8
            let dividers = zip(item.actions, item.actions.dropFirst()).filter { !$0.0.destructive && $0.1.destructive }.count
            let menuHeight = CGFloat(item.actions.count) * rowHeight + CGFloat(dividers) * 9 + 12
            let above = barHeight > 0 ? barHeight + gap : 0
            let room = size.height - insets.top - insets.bottom - 16
            let bubbleHeight = min(item.frame.height, max(60, room - above - gap - menuHeight))
            let total = above + bubbleHeight + gap + menuHeight
            let top = min(max(item.frame.minY - above, insets.top + 8), size.height - insets.bottom - 8 - total)
            let bubbleTop = top + above
            ZStack(alignment: .topLeading) {
                backdrop
                if barHeight > 0 {
                    reactionsBar(cell: cell)
                        .scaleEffect(shown ? 1 : 0.4, anchor: item.mine ? .bottomTrailing : .bottomLeading)
                        .opacity(shown ? 1 : 0)
                        .offset(x: clampX(item.mine ? item.frame.maxX - barWidth : item.frame.minX, width: barWidth, in: size), y: top)
                }
                item.bubble
                    .frame(width: item.frame.width, height: bubbleHeight, alignment: .top)
                    .clipped()
                    .allowsHitTesting(false)
                    .offset(x: item.frame.minX, y: bubbleTop)
                menu
                    .scaleEffect(shown ? 1 : 0.5, anchor: item.mine ? .topTrailing : .topLeading)
                    .opacity(shown ? 1 : 0)
                    .offset(x: clampX(item.mine ? item.frame.maxX - menuWidth : item.frame.minX, width: menuWidth, in: size), y: bubbleTop + bubbleHeight + gap)
            }
            .frame(width: size.width, height: size.height, alignment: .topLeading)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) { shown = true }
        }
        .accessibilityAddTraits(.isModal)
    }

    private var backdrop: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial)
            Color.black.opacity(0.35)
        }
        .opacity(shown ? 1 : 0)
        .contentShape(Rectangle())
        .onTapGesture { finish() }
        .accessibilityLabel("Закрыть")
        .accessibilityAddTraits(.isButton)
    }

    private func reactionsBar(cell: CGFloat) -> some View {
        HStack(spacing: 2) {
            ForEach(item.reactions, id: \.self) { emoji in
                Button {
                    let pick = emoji == item.chosen ? nil : emoji
                    finish { item.react(pick) }
                } label: {
                    Text(emoji)
                        .font(.system(size: cell * 0.66))
                        .frame(width: cell, height: cell)
                        .background(Circle().fill(Color.white.opacity(emoji == item.chosen ? 0.22 : 0)))
                }
                .buttonStyle(ReactionPressStyle())
                .accessibilityIdentifier("reaction-" + emoji)
                .accessibilityLabel(emoji == item.chosen ? "Убрать реакцию \(emoji)" : "Реакция \(emoji)")
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .glassCapsule()
    }

    private var menu: some View {
        VStack(spacing: 0) {
            ForEach(Array(item.actions.enumerated()), id: \.element.id) { index, action in
                if index > 0 && action.destructive && !item.actions[index - 1].destructive {
                    Rectangle()
                        .fill(Color.white.opacity(0.12))
                        .frame(height: 1)
                        .padding(.vertical, 4)
                        .padding(.horizontal, 18)
                }
                Button {
                    finish { action.run() }
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: action.icon)
                            .font(.system(size: 18))
                            .frame(width: 24)
                        Text(action.title)
                            .font(.system(size: 17))
                        Spacer(minLength: 0)
                    }
                    .foregroundColor(action.destructive ? Noct.red : .white)
                    .padding(.horizontal, 18)
                    .frame(height: rowHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(SettingsRowStyle())
                .accessibilityLabel(action.title)
            }
        }
        .padding(.vertical, 6)
        .frame(width: menuWidth)
        .glassRect(22)
    }

    private func clampX(_ x: CGFloat, width: CGFloat, in size: CGSize) -> CGFloat {
        min(max(x, 8), max(8, size.width - 8 - width))
    }

    private func finish(then action: (() -> Void)? = nil) {
        withAnimation(.easeOut(duration: 0.16)) { shown = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) {
            close()
            action?()
        }
    }
}

/// Emoji grow a little under the finger.
private struct ReactionPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 1.25 : 1)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// Holding a bubble reports its frame on screen, to lift it into MessageFocus.
/// A quick tap still reaches photos and links inside.
struct HoldToFocus: ViewModifier {
    let action: ((CGRect) -> Void)?
    @State private var measuring = false

    @ViewBuilder
    func body(content: Content) -> some View {
        if let action {
            content
                .background {
                    if measuring {
                        GeometryReader { proxy in
                            Color.clear.onAppear {
                                measuring = false
                                action(proxy.frame(in: .global))
                            }
                        }
                    }
                }
                .highPriorityGesture(
                    LongPressGesture(minimumDuration: 0.35).onEnded { _ in measuring = true }
                )
                .accessibilityAction(named: "Действия") { measuring = true }
        } else {
            content
        }
    }
}

/// Swipe a message left to answer it, as in Telegram: the row follows the
/// finger, an arrow appears on the right and a tick of haptics marks the
/// point where letting go replies.
struct SwipeToReply: ViewModifier {
    let action: (() -> Void)?
    @GestureState(resetTransaction: Transaction(animation: .spring(response: 0.3, dampingFraction: 0.8)))
    private var swipe = Swipe()

    private let threshold: CGFloat = 64

    struct Swipe {
        var horizontal: Bool?
        var offset: CGFloat = 0
        var armed = false
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if let action {
            let offset = swipe.horizontal == true ? swipe.offset : 0
            let progress = min(1, -offset / threshold)
            content
                .offset(x: offset)
                .overlay(alignment: .trailing) {
                    Image(systemName: "arrowshape.turn.up.left.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Color.white.opacity(swipe.armed ? 0.3 : 0.14)))
                        .scaleEffect(0.5 + 0.5 * progress)
                        .opacity(progress)
                        .padding(.trailing, 10)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
                .simultaneousGesture(
                    DragGesture(minimumDistance: 14)
                        .updating($swipe) { value, state, _ in
                            let dx = value.translation.width, dy = value.translation.height
                            if state.horizontal == nil {
                                state.horizontal = dx < 0 && abs(dx) > abs(dy) * 1.2
                            }
                            guard state.horizontal == true else { return }
                            let pulled = min(0, dx)
                            state.offset = pulled > -threshold ? pulled : -threshold + (pulled + threshold) * 0.3
                            let armed = pulled <= -threshold
                            if armed != state.armed {
                                state.armed = armed
                                if armed { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
                            }
                        }
                        .onEnded { value in
                            let dx = value.translation.width, dy = value.translation.height
                            if dx <= -threshold && abs(dx) > abs(dy) * 1.2 { action() }
                        }
                )
        } else {
            content
        }
    }
}

/// Where to forward a message: recent dialogues, or anyone found by name.
struct ForwardSheet: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let send: (Person) -> Void
    @State private var query = ""
    @State private var recent: [Person] = []
    @State private var found: [Person] = []

    private var term: String { query.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            List {
                ForEach(term.isEmpty ? recent : found) { person in
                    Button {
                        send(person)
                        dismiss()
                    } label: {
                        PersonRow(person: person.identity)
                    }
                    .listRowBackground(Noct.sheetRow)
                }
                if (term.isEmpty ? recent : found).isEmpty {
                    Text(term.isEmpty ? "Начни вводить имя или юзернейм" : "Никого не нашли")
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text48)
                        .listRowBackground(Noct.sheetRow)
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .sheetSurface()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Кому переслать")
            .navigationTitle("Переслать")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
            }
            .task {
                if let data = try? await session.api.social("threads") {
                    recent = data.array.map { Person($0) }.filter { $0.id != "noctgram" }
                }
                if recent.isEmpty { recent = session.people }
            }
            .task(id: term) {
                guard !term.isEmpty else { return }
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                if let data = try? await session.api.social("people", ["q": term]) {
                    found = data.array.map { Person($0) }.filter { $0.id != session.myId }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

enum ScreenInsets {
    /// Safe area of the key window (the focus overlay ignores it).
    static var current: UIEdgeInsets {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first { $0.isKeyWindow }?
            .safeAreaInsets ?? .zero
    }
}
