import SwiftUI
import UIKit

/// Design tokens from DESIGN.md: a pure black base, near-black cards and
/// white text at 100/75/60/48 %.
enum Noct {
    static let background = Color.black
    static let card = Color(hex: 0x0C0C0C)
    static let elevated = Color(hex: 0x161616)
    static let coverFill = Color(hex: 0x141414)
    static let selected = Color(hex: 0x242424)
    /// Grouped rows of the profile and settings screens (iOS inset groups).
    static let group = Color(hex: 0x1C1C1E)
    static let avatarFill = Color(hex: 0x202020)

    static let text = Color.white
    static let text75 = Color.white.opacity(0.75)
    static let text60 = Color.white.opacity(0.6)
    static let text48 = Color.white.opacity(0.48)
    static let text25 = Color.white.opacity(0.25)

    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.14)
    static let fill = Color.white.opacity(0.06)
    static let fillStrong = Color.white.opacity(0.10)
    static let fillHeavy = Color.white.opacity(0.14)

    static let green = Color(hex: 0x3ECF8E)
    static let red = Color(hex: 0xEF4444)
    static let gold = Color(hex: 0xFFD36A)
    static let lilac = Color(hex: 0xAF9ADD)
    static let incoming = Color(hex: 0x121212)
    static let outgoing = Color(hex: 0x242424)

    static let motion = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.34)
    static let quick = Animation.timingCurve(0.22, 1, 0.36, 1, duration: 0.24)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    /// "#rrggbb" from the API (profile backgrounds, gift backdrops).
    init?(hexString: String) {
        var value = hexString.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6, let number = UInt32(value, radix: 16) else { return nil }
        self.init(hex: number)
    }
}

/// Profile palettes from lib/appearance.ts.
enum ProfileTheme: String, CaseIterable, Identifiable {
    case iris, aurora, ocean, rose, ember, silver

    var id: String { rawValue }

    init(key: String) {
        self = ProfileTheme(rawValue: key) ?? .iris
    }

    var label: String {
        switch self {
        case .iris: return "Ирис"
        case .aurora: return "Сияние"
        case .ocean: return "Океан"
        case .rose: return "Роза"
        case .ember: return "Закат"
        case .silver: return "Лунный"
        }
    }

    /// The two palette colours as lib/appearance.ts writes them.
    var hexes: (first: UInt32, second: UInt32) {
        switch self {
        case .iris: return (0xC9A9FF, 0x9CCAFF)
        case .aurora: return (0x87E7D6, 0xBCE8A3)
        case .ocean: return (0x84CEFF, 0xBAB3FF)
        case .rose: return (0xFFA8CB, 0xD7B2FF)
        case .ember: return (0xFFC88C, 0xFFA6B3)
        case .silver: return (0xFAFAFF, 0xA9B4CB)
        }
    }

    var first: Color { Color(hex: hexes.first) }

    var second: Color { Color(hex: hexes.second) }

    var wash: Color {
        switch self {
        case .iris: return Color(hex: 0xA88AD8)
        case .aurora: return Color(hex: 0x78C9B5)
        case .ocean: return Color(hex: 0x80ACD9)
        case .rose: return Color(hex: 0xDA96BC)
        case .ember: return Color(hex: 0xD4A180)
        case .silver: return Color(hex: 0xA6AFBF)
        }
    }

    var gradient: LinearGradient {
        LinearGradient(colors: [first, second], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

extension Appearance {
    var theme: ProfileTheme { ProfileTheme(key: profileTheme) }

    /// Accent for links and highlighted rows: the Premium palette, lilac otherwise.
    var accent: Color { premium ? theme.first : Noct.lilac }
}

// MARK: - Buttons

/// Main action (Подписаться, Опубликовать): bright white glass, dark label.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.black)
            .padding(.horizontal, 18)
            .frame(minHeight: 38)
            .glassCapsule(interactive: true, tint: .white)
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !LiquidGlass.isNative ? 0.97 : 1)
            .animation(Noct.quick, value: configuration.isPressed)
    }
}

/// Glass capsule with a white label (Редактировать, Вы подписаны).
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundColor(.white)
            .padding(.horizontal, 16)
            .frame(minHeight: 38)
            .glassCapsule(interactive: true)
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !LiquidGlass.isNative ? 0.97 : 1)
            .animation(Noct.quick, value: configuration.isPressed)
    }
}

/// Round glass icon button.
struct CircleButtonStyle: ButtonStyle {
    var size: CGFloat = 38
    var tint: Color?
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .medium))
            .foregroundColor(tint == nil ? .white : .black)
            .frame(width: size, height: size)
            .glassCircle(interactive: true, tint: tint)
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !LiquidGlass.isNative ? 0.94 : 1)
            .animation(Noct.quick, value: configuration.isPressed)
    }
}

/// Small glass chip for filters and topics; the selected one is bright.
struct ChipButtonStyle: ButtonStyle {
    var selected = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(selected ? .black : Noct.text75)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .glassCapsule(interactive: true, tint: selected ? .white : nil)
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed && !LiquidGlass.isNative ? 0.96 : 1)
            .animation(Noct.quick, value: configuration.isPressed)
    }
}

/// Plain tap feedback without the default blue tint.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(Noct.quick, value: configuration.isPressed)
    }
}

// MARK: - Surfaces

extension View {
    /// Card surface: #0C0C0C, 16 pt radius and a hairline border.
    func noctCard(radius: CGFloat = 16) -> some View {
        background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Noct.card))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(Noct.border, lineWidth: 1))
    }

    /// Input field surface used in forms; translucent, so it sits on black
    /// pages and on glass sheets alike.
    func noctField() -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.06)))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Noct.borderStrong, lineWidth: 1))
    }

    func hairlineDivider() -> some View {
        overlay(alignment: .bottom) { Rectangle().fill(Noct.border).frame(height: 0.5) }
    }
}

enum Haptics {
    static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }
}

/// System bars. iOS 26 draws Liquid Glass bars itself (a custom background
/// would hide the glass); earlier systems get frosted, translucent bars.
enum BarAppearance {
    static func apply() {
        // Compact tab titles, so «Сообщения» fits next to the other tabs.
        let tabTitle = UIFont.systemFont(ofSize: 10, weight: .semibold)
        UITabBarItem.appearance().setTitleTextAttributes([.font: tabTitle], for: .normal)
        UITabBarItem.appearance().setTitleTextAttributes([.font: tabTitle], for: .selected)
        if #available(iOS 26.0, *) {
            UINavigationBar.appearance().tintColor = .white
            return
        }
        let blur = UIBlurEffect(style: .systemUltraThinMaterialDark)
        let nav = UINavigationBarAppearance()
        nav.configureWithDefaultBackground()
        nav.backgroundEffect = blur
        nav.backgroundColor = UIColor.black.withAlphaComponent(0.5)
        nav.shadowColor = UIColor.white.withAlphaComponent(0.08)
        nav.titleTextAttributes = [.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 17, weight: .semibold)]
        nav.largeTitleTextAttributes = [.foregroundColor: UIColor.white, .font: UIFont.systemFont(ofSize: 30, weight: .bold)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = .white

        let tab = UITabBarAppearance()
        tab.configureWithDefaultBackground()
        tab.backgroundEffect = blur
        tab.backgroundColor = UIColor.black.withAlphaComponent(0.5)
        tab.shadowColor = UIColor.white.withAlphaComponent(0.08)
        let item = UITabBarItemAppearance()
        item.normal.iconColor = UIColor.white.withAlphaComponent(0.45)
        item.normal.titleTextAttributes = [.foregroundColor: UIColor.white.withAlphaComponent(0.45), .font: tabTitle]
        item.selected.iconColor = .white
        item.selected.titleTextAttributes = [.foregroundColor: UIColor.white, .font: tabTitle]
        item.normal.badgeBackgroundColor = .white
        item.normal.badgeTextAttributes = [.foregroundColor: UIColor.black]
        tab.stackedLayoutAppearance = item
        tab.inlineLayoutAppearance = item
        tab.compactInlineLayoutAppearance = item
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}
