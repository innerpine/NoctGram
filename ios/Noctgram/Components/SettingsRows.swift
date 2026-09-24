import SwiftUI

/// Colours of the Settings-style icons (iOS system colours, dark variants).
enum IconColor {
    static let red = Color(hex: 0xFF453A)
    static let orange = Color(hex: 0xFF9F0A)
    static let green = Color(hex: 0x30D158)
    static let teal = Color(hex: 0x40C8E0)
    static let blue = Color(hex: 0x0A84FF)
    static let indigo = Color(hex: 0x5E5CE6)
    static let purple = Color(hex: 0xBF5AF2)
    static let pink = Color(hex: 0xFF375F)
    static let gray = Color(hex: 0x8E8E93)
}

/// An icon as in Apple's apps: a white symbol on a coloured rounded square
/// lit a little from the top.
struct SettingsIcon: View {
    let symbol: String
    let color: Color
    var size: CGFloat = 30

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
        Image(systemName: symbol)
            .font(.system(size: size * 0.5, weight: .semibold))
            .foregroundColor(.white)
            .frame(width: size, height: size)
            .background(
                shape
                    .fill(color)
                    .overlay(shape.fill(LinearGradient(colors: [.white.opacity(0.24), .white.opacity(0)], startPoint: .top, endPoint: .bottom)))
            )
    }
}

/// A rounded group of rows on the black page.
struct SettingsGroup<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .background(Noct.group)
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .padding(.horizontal, 16)
    }
}

/// A row: icon, title, an optional value and a chevron. The divider starts
/// under the title, as in inset grouped lists.
struct SettingsRow<Leading: View>: View {
    let title: String
    var value: String?
    var titleColor: Color
    var chevron: Bool
    var divider: Bool
    let action: (() -> Void)?
    let leading: Leading

    init(
        _ title: String,
        value: String? = nil,
        titleColor: Color = .white,
        chevron: Bool = true,
        divider: Bool = true,
        action: (() -> Void)?,
        @ViewBuilder leading: () -> Leading
    ) {
        self.title = title
        self.value = value
        self.titleColor = titleColor
        self.chevron = chevron
        self.divider = divider
        self.action = action
        self.leading = leading()
    }

    var body: some View {
        if let action {
            Button(action: action) { row }
                .buttonStyle(SettingsRowStyle())
        } else {
            row
        }
    }

    private var row: some View {
        HStack(spacing: 16) {
            leading
                .frame(width: 30, height: 30)
            Text(title)
                .font(.system(size: 17))
                .foregroundColor(titleColor)
                .lineLimit(1)
            Spacer(minLength: 8)
            if let value {
                Text(value)
                    .font(.system(size: 17))
                    .foregroundColor(Noct.text48)
                    .lineLimit(1)
            }
            if chevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.3))
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 52)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            if divider {
                Rectangle()
                    .fill(Color.white.opacity(0.1))
                    .frame(height: 0.5)
                    .padding(.leading, 62)
                    .padding(.trailing, 16)
            }
        }
    }
}

extension SettingsRow where Leading == SettingsIcon {
    init(_ title: String, icon: String, color: Color, value: String? = nil, chevron: Bool = true, divider: Bool = true, action: (() -> Void)?) {
        self.init(title, value: value, chevron: chevron, divider: divider, action: action) {
            SettingsIcon(symbol: icon, color: color)
        }
    }
}

/// Rows light up while pressed, like list cells.
struct SettingsRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.white.opacity(0.08) : Color.clear)
    }
}
