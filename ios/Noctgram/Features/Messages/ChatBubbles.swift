import SwiftUI
import UIKit

/// Dialogue palettes of lib/chat-themes.ts: the eight themes of the web,
/// chosen per chat on the server (action=messages&includeTheme=1).
struct ChatPalette: Equatable {
    let id: String
    let base: Color
    let glow: Color
    let field: Color
    let incoming: Color
    let outgoing: Color
    let accent: Color

    private static let table: [(String, UInt32, UInt32, UInt32, UInt32, UInt32)] = [
        ("noct", 0x0B0B0C, 0x1B1B20, 0x111113, 0x242426, 0xDEDEE6),
        ("aurora", 0x0B1418, 0x2C706C, 0x12272B, 0x24423F, 0xB7E0D2),
        ("dusk", 0x13111E, 0x625088, 0x201C31, 0x3D3153, 0xD6C5EE),
        ("rose", 0x1B1218, 0x885669, 0x2E1F2A, 0x50323E, 0xEAC7D2),
        ("amber", 0x19150F, 0x8D6D46, 0x2C241B, 0x4A3928, 0xECD4AF),
        ("mist", 0x141A1E, 0x657C87, 0x222C33, 0x3A4B54, 0xD1E0E7),
        ("ocean", 0x0D1422, 0x335C86, 0x18263A, 0x28405E, 0xBFD6F1),
        ("olive", 0x141811, 0x616E49, 0x242B1D, 0x3B472E, 0xD7DFB9),
    ]

    init(id: String) {
        let row = Self.table.first { $0.0 == id } ?? Self.table[0]
        self.id = row.0
        base = Color(hex: row.1)
        glow = Color(hex: row.2)
        field = Color(hex: row.3)
        // The web draws bubbles at 93 % («ed») over the backdrop.
        incoming = Color(hex: row.3, opacity: 0.93)
        outgoing = Color(hex: row.4, opacity: 0.93)
        accent = Color(hex: row.5)
    }

    static let noct = ChatPalette(id: "noct")
}

/// The chat backdrop of the web theme: soft gradients, no pattern.
struct ChatBackdrop: View {
    let palette: ChatPalette

    var body: some View {
        GeometryReader { geometry in
            let size = max(geometry.size.width, geometry.size.height)
            ZStack {
                if palette.id == "noct" {
                    LinearGradient(colors: [palette.base, Color(hex: 0x101013)], startPoint: .topLeading, endPoint: .bottomTrailing)
                } else {
                    LinearGradient(colors: [palette.base, palette.field, palette.base], startPoint: UnitPoint(x: 0.3, y: 0), endPoint: UnitPoint(x: 0.7, y: 1))
                    RadialGradient(colors: [palette.glow.opacity(0.4), .clear], center: UnitPoint(x: 0.05, y: 0.12), startRadius: 0, endRadius: size * 0.55)
                    RadialGradient(colors: [palette.glow.opacity(0.28), .clear], center: UnitPoint(x: 0.92, y: 0.8), startRadius: 0, endRadius: size * 0.58)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

/// Keeps a chat on its newest message, as in Telegram, while the reader is
/// at the end: when the keyboard opens, a reply appears over the composer
/// or a bubble grows (a reaction). Scrolls explicitly: on iOS 26 a bottom
/// scroll anchor over a lazy stack jumps when the keyboard moves.
struct ChatFollowsEnd<Messages: Equatable>: ViewModifier {
    let proxy: ScrollViewProxy
    let last: String?
    /// The newest message is on screen.
    let atEnd: Bool
    /// The reply or edit shown over the composer.
    let bar: String?
    let messages: Messages

    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidShowNotification)) { _ in follow() }
            .onChange(of: bar) { _ in follow() }
            .onChange(of: messages) { _ in follow() }
    }

    private func follow() {
        guard atEnd, let last else { return }
        // On the next pass, once the reply bar or the grown bubble is laid out.
        DispatchQueue.main.async {
            withAnimation(Noct.quick) { proxy.scrollTo(last, anchor: .bottom) }
        }
    }
}

/// Whether a chat shows its end: from the scroll geometry on iOS 18 (within
/// 60 pt of the newest message), from the newest row appearing earlier.
struct ChatEndTracker: ViewModifier {
    @Binding var atEnd: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            if ChatProbe.has("notracker") {
                content
            } else {
                content.onScrollGeometryChange(for: Bool.self) { geometry in
                    ChatProbe.count("geometry y \(Int(geometry.contentOffset.y / 10) * 10) h \(Int(geometry.contentSize.height / 10) * 10)")
                    return geometry.visibleRect.maxY - geometry.contentInsets.bottom >= geometry.contentSize.height - 60
                } action: { _, end in
                    atEnd = end
                    ChatProbe.count("at end \(end)")
                }
            }
        } else {
            content
        }
    }
}

/// The column of a chat's messages. From iOS 18 a plain stack: a lazy one
/// with bubbles this different in height (a line of text next to a photo)
/// flipped a row above the screen between its measured height and a larger
/// estimate at some scroll offsets, and iOS 26 laid the chat out without
/// end (the gesture tests caught it; ChatProbe counted the flips). A chat
/// draws its newest messages only (ChatWindow), so the stack stays small.
struct ChatColumn<Content: View>: View {
    var alignment: HorizontalAlignment = .center
    @ViewBuilder let content: () -> Content

    var body: some View {
        if #available(iOS 18.0, *) {
            VStack(alignment: alignment, spacing: 0, content: content)
        } else {
            LazyVStack(alignment: alignment, spacing: 0, content: content)
        }
    }
}

/// How many messages a chat draws: the newest `step` when it opens, more
/// from «Показать ранние сообщения». New messages add to the end.
struct ChatWindow {
    static let step = 50
    /// Messages kept out above, fixed once the chat has loaded.
    var hidden: Int?

    func start(_ count: Int) -> Int {
        min(hidden ?? max(0, count - Self.step), count)
    }
}

struct EarlierMessagesButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text("Показать ранние сообщения")
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(Noct.text75)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Capsule().fill(Color.white.opacity(0.08)))
        }
        .buttonStyle(PressableStyle())
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
    }
}

/// A bubble is one VoiceOver element with a line to say (the text or what
/// is attached, the reactions, the time) rather than the combined labels of
/// its parts: the chips with faces read badly and cost a walk through them.
struct SpokenBubble: ViewModifier {
    let label: String

    func body(content: Content) -> some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
    }

    /// «🔥 2», one per reaction.
    static func reactions(_ reactions: [Reaction]) -> [String] {
        reactions.map { "\($0.emoji) \($0.count)" }
    }
}

/// iOS 16 and 17: the newest row tells when it comes and goes.
struct ChatEndRow: ViewModifier {
    let isLast: Bool
    @Binding var atEnd: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content
        } else {
            content
                .onAppear { if isLast { atEnd = true } }
                .onDisappear { if isLast { atEnd = false } }
        }
    }
}

/// A bubble with its own radius per corner (UnevenRoundedRectangle needs iOS 17).
struct BubbleShape: Shape {
    var topLeading: CGFloat
    var topTrailing: CGFloat
    var bottomLeading: CGFloat
    var bottomTrailing: CGFloat

    /// Corners of a message: small on the sender's side where the group
    /// continues and at the bottom, like the web's tail corner.
    static func message(mine: Bool, joinsPrevious: Bool) -> BubbleShape {
        let large: CGFloat = 18, small: CGFloat = 6
        return mine
            ? BubbleShape(topLeading: large, topTrailing: joinsPrevious ? small : large, bottomLeading: large, bottomTrailing: small)
            : BubbleShape(topLeading: joinsPrevious ? small : large, topTrailing: large, bottomLeading: small, bottomTrailing: large)
    }

    func path(in rect: CGRect) -> Path {
        let limit = min(rect.width, rect.height) / 2
        let tl = min(topLeading, limit), tr = min(topTrailing, limit)
        let bl = min(bottomLeading, limit), br = min(bottomTrailing, limit)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - tr, y: rect.minY))
        path.addArc(center: CGPoint(x: rect.maxX - tr, y: rect.minY + tr), radius: tr, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
        path.addArc(center: CGPoint(x: rect.maxX - br, y: rect.maxY - br), radius: br, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        path.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
        path.addArc(center: CGPoint(x: rect.minX + bl, y: rect.maxY - bl), radius: bl, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
        path.addArc(center: CGPoint(x: rect.minX + tl, y: rect.minY + tl), radius: tl, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.closeSubpath()
        return path
    }
}

/// Stacks a bubble's parts as wide as the widest one (capped by the offered
/// width), so quotes and media span the bubble while text keeps wrapping.
struct BubbleStack: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        ChatProbe.count("stack size")
        let width = columnWidth(proposal, subviews)
        let height = subviews.reduce(CGFloat(0)) { $0 + $1.sizeThatFits(ProposedViewSize(width: width, height: nil)).height }
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        ChatProbe.count("stack place")
        var y = bounds.minY
        for subview in subviews {
            let height = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil)).height
            subview.place(at: CGPoint(x: bounds.minX, y: y), proposal: ProposedViewSize(width: bounds.width, height: height))
            y += height
        }
    }

    private func columnWidth(_ proposal: ProposedViewSize, _ subviews: Subviews) -> CGFloat {
        let limit = proposal.width ?? .infinity
        let widest = subviews.map { min($0.sizeThatFits(.unspecified).width, limit) }.max() ?? 0
        return min(widest, limit)
    }
}

enum MessageStatus {
    case pending, failed, sent, read

    var symbol: String {
        switch self {
        case .pending: return "clock"
        case .failed: return "exclamationmark.circle"
        case .sent: return "checkmark.circle"
        case .read: return "checkmark.circle.fill"
        }
    }
}

/// «изм. 23:02 ✓», drawn at the end of the last line or over a photo.
struct BubbleTime: View {
    let created: Double
    var edited = false
    var status: MessageStatus?
    var onMedia = false
    var mine = false
    var pinned = false

    var body: some View {
        if onMedia {
            label(color: .white)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Capsule().fill(Color.black.opacity(0.45)))
        } else {
            label(color: mine ? Color.white.opacity(0.6) : Noct.text48)
        }
    }

    private func label(color: Color) -> some View {
        HStack(spacing: 3) {
            if pinned { Image(systemName: "pin.fill").font(.system(size: 9)) }
            if edited { Text("изм.") }
            Text(Format.clock(created))
            if let status {
                Image(systemName: status.symbol)
                    .foregroundColor(status == .failed ? Noct.red : (status == .read ? .white : color))
            }
        }
        .font(.system(size: 11))
        .foregroundColor(color)
        .fixedSize()
    }

    /// Invisible text as wide as the label, appended to the message so the
    /// last line leaves room for it (the time floats right on the web).
    var placeholder: Text {
        var text = Text("\u{2002}\u{2002}")
        if pinned { text = text + Text(Image(systemName: "pin.fill")).font(.system(size: 9)) + Text(" ") }
        if edited { text = text + Text("изм. ") }
        text = text + Text(Format.clock(created))
        if let status { text = text + Text(" ") + Text(Image(systemName: status.symbol)) }
        return text.font(.system(size: 11)).foregroundColor(.clear)
    }
}

/// Message text with tappable links and, when given, the time at the end
/// of the last line.
struct InlineTimeText: View {
    @EnvironmentObject private var session: AppSession
    let text: String
    var time: BubbleTime?
    var accent: Color = .white

    var body: some View {
        let _ = ChatProbe.count("text body")
        let message = Text(RichText.attributed(text, baseURL: session.api.baseURL))
            .font(.system(size: 16))
            .foregroundColor(Color.white.opacity(0.93))
        (time.map { message + $0.placeholder } ?? message)
            .lineSpacing(2)
            .tint(accent)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottomTrailing) {
                if let time { time.accessibilityHidden(true) }
            }
    }
}

/// A quoted message inside a bubble: accent bar, author and one line.
struct BubbleQuote: View {
    let name: String
    let text: String
    let accent: Color

    var body: some View {
        HStack(spacing: 8) {
            Capsule().fill(accent).frame(width: 3)
            VStack(alignment: .leading, spacing: 1) {
                Text(name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(accent)
                    .lineLimit(1)
                Text(text)
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text75)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 5)
        .padding(.leading, 6)
        .padding(.trailing, 10)
        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(accent.opacity(0.13)))
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// Reactions under a message, as in Telegram: the emoji with the faces of
/// up to three people who chose it, one behind another; from four people
/// on, or when it is unknown who reacted, the count. The viewer's own
/// reaction is filled with the accent. A tap puts the reaction or takes it
/// back.
struct BubbleReactions: View {
    let reactions: [Reaction]
    let accent: Color
    /// Who chose the reaction, when known; nil shows the count.
    var reactors: (Reaction) -> [Identity]? = { _ in nil }
    var toggle: ((String?) -> Void)?

    var body: some View {
        FlowRows(spacing: 5) {
            ForEach(reactions, id: \.emoji) { reaction in
                // A tap, not a button: the bubble stays one element for
                // VoiceOver, where the held-message menu sets reactions.
                chip(reaction)
                    .contentShape(Capsule())
                    .onTapGesture {
                        guard let toggle else { return }
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        toggle(reaction.own ? nil : reaction.emoji)
                    }
            }
        }
    }

    private func chip(_ reaction: Reaction) -> some View {
        let people = reaction.count <= 3 ? reactors(reaction).flatMap { $0.count == reaction.count ? $0 : nil } : nil
        return HStack(spacing: 4) {
            Text(reaction.emoji)
                .font(.system(size: 17))
            if let people {
                StackedAvatars(people: people, size: 24)
            } else {
                Text(Format.count(reaction.count))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(reaction.own ? Color.black.opacity(0.8) : accent)
                    .monospacedDigit()
                    .padding(.trailing, 5)
            }
        }
        .padding(.leading, 8)
        .padding(.trailing, 3)
        .frame(height: 30)
        .background(Capsule().fill(reaction.own ? accent : accent.opacity(0.18)))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(people.map { "\(reaction.emoji) " + $0.map(\.name).joined(separator: ", ") } ?? "\(reaction.emoji) \(reaction.count)")
    }
}

/// Faces overlapping from left to right, each tucked behind the one before
/// it with a thin transparent gap, as under Telegram reactions.
struct StackedAvatars: View {
    let people: [Identity]
    var size: CGFloat = 24
    private let gap: CGFloat = 1.5

    private var step: CGFloat { size * 0.62 }

    var body: some View {
        ZStack(alignment: .leading) {
            ForEach(Array(people.enumerated()), id: \.offset) { index, person in
                AvatarView(person: person, size: size, ring: false)
                    .mask {
                        Rectangle()
                            .overlay(alignment: .leading) {
                                if index > 0 {
                                    Circle()
                                        .frame(width: size + gap * 2, height: size + gap * 2)
                                        .offset(x: -step - gap)
                                        .blendMode(.destinationOut)
                                }
                            }
                            .compositingGroup()
                    }
                    .offset(x: CGFloat(index) * step)
            }
        }
        .frame(width: size + CGFloat(max(0, people.count - 1)) * step, height: size, alignment: .leading)
    }
}

/// Views in rows that wrap like words (reaction chips).
struct FlowRows: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        ChatProbe.count("flow size")
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        ChatProbe.count("flow place")
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !row.items.isEmpty && row.width + spacing + size.width > width {
                rows.append(row)
                row = Row()
            }
            row.width += (row.items.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}

/// Photos and videos of one message, edge to edge as in Telegram: one
/// picture keeps its proportions, several share a 2 pt grid.
struct ChatMedia: View {
    @EnvironmentObject private var session: AppSession
    let items: [MediaItem]
    let size: CGSize
    let open: (Int) -> Void
    private let gap: CGFloat = 2

    var body: some View {
        Group {
            switch items.count {
            case 1:
                tile(0)
            case 2:
                HStack(spacing: gap) { tile(0); tile(1) }
            case 3:
                VStack(spacing: gap) {
                    tile(0).frame(height: (size.height - gap) * 0.56)
                    HStack(spacing: gap) { tile(1); tile(2) }
                }
            default:
                VStack(spacing: gap) {
                    HStack(spacing: gap) { tile(0); tile(1) }
                    HStack(spacing: gap) {
                        tile(2)
                        tile(3).overlay {
                            if items.count > 4 {
                                ZStack {
                                    Color.black.opacity(0.45)
                                    Text("+\(items.count - 4)")
                                        .font(.system(size: 22, weight: .semibold))
                                        .foregroundColor(.white)
                                }
                                .allowsHitTesting(false)
                            }
                        }
                    }
                }
            }
        }
        .frame(width: size.width, height: size.height)
    }

    /// Layout size for these items; one item follows its picture's shape.
    static func size(count: Int, ratio: CGFloat?, maxWidth: CGFloat) -> CGSize {
        switch count {
        case 1:
            let shape = min(max(ratio ?? 0.8, 0.56), 1.9)
            let width = min(maxWidth, 340 * shape)
            return CGSize(width: width, height: width / shape)
        case 2: return CGSize(width: maxWidth, height: maxWidth * 0.62)
        case 3: return CGSize(width: maxWidth, height: maxWidth * 0.9)
        default: return CGSize(width: maxWidth, height: maxWidth)
        }
    }

    private func tile(_ index: Int) -> some View {
        let item = items[index]
        return Button {
            open(index)
        } label: {
            ZStack {
                if item.isVideo {
                    VideoThumbnail(url: session.api.mediaURL(item.path))
                    Image(systemName: "play.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Color.black.opacity(0.45)))
                } else {
                    RemoteImage(url: session.api.mediaURL(item.path), maxPixel: 900)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
    }
}
