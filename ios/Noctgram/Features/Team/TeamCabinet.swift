import SwiftUI

/// «Кабинет команды» for moderators and administrators (app/moderation-panel.tsx):
/// the sections as rows, like the profile tab. Moderators see «Модерация»
/// without «Управление».
struct TeamCabinetView: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator

    private var admin: Bool { session.me?.canAdmin == true }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 10) {
                    SettingsIcon(symbol: "checkmark.shield.fill", color: IconColor.teal, size: 64)
                    Text(admin ? "Кабинет команды" : "Модерация")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white)
                    Text("Аккаунты, обращения и безопасность NoctGram")
                        .font(.system(size: 14))
                        .foregroundColor(Noct.text60)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 12)
                .padding(.horizontal, 32)
                SettingsGroup {
                    row(.antispam, icon: "shield.lefthalf.filled", color: IconColor.green)
                    row(.accounts(nil), icon: "person.2.fill", color: IconColor.blue)
                    row(.appeals, icon: "bubble.left.and.bubble.right.fill", color: IconColor.indigo)
                    row(.reports, icon: "flag.fill", color: IconColor.orange)
                    row(.removals, icon: "trash.fill", color: IconColor.red, divider: admin)
                    if admin {
                        row(.administration, icon: "slider.horizontal.3", color: IconColor.purple, divider: false)
                    }
                }
            }
            .padding(.bottom, 32)
        }
        .background(Noct.background)
        .navigationTitle(admin ? "Кабинет команды" : "Модерация")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ section: TeamSection, icon: String, color: Color, divider: Bool = true) -> some View {
        SettingsRow(section.title, icon: icon, color: color, divider: divider) {
            nav.push(.teamSection(section))
        }
    }
}

/// The screen of one section.
struct TeamSectionView: View {
    let section: TeamSection

    var body: some View {
        switch section {
        case .antispam: TeamAntispamView()
        case .accounts(let target): TeamAccountsView(target: target)
        case .appeals: TeamAppealsView()
        case .reports: TeamReportsView()
        case .removals: TeamRemovalsView()
        case .administration: TeamAdministrationView()
        }
    }
}

// MARK: - Parts shared by the sections

/// A card of a queue (moderation-queue article).
struct TeamCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Noct.card))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Noct.border, lineWidth: 1))
    }
}

/// A coloured status chip (staff-status, report-status).
struct TeamChip: View {
    let status: TeamStatus

    var body: some View {
        Text(status.title)
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(status.color)
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(Capsule().fill(status.color.opacity(0.14)))
            .fixedSize()
    }
}

/// A caption, a text area and its count.
struct TeamNoteField: View {
    let title: String
    @Binding var text: String
    var limit = 500
    var placeholder = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(title)
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text60)
                Spacer(minLength: 8)
                Text(verbatim: "\(text.count)/\(limit)")
                    .font(.system(size: 11))
                    .foregroundColor(Noct.text48)
            }
            TextField(placeholder, text: Binding(get: { text }, set: { text = String($0.prefix(limit)) }), axis: .vertical)
                .lineLimit(2...6)
                .noctField()
        }
    }
}

/// A search field with a clear button (staff-search).
struct TeamSearchField: View {
    @Binding var text: String
    let placeholder: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(Noct.text48)
            TextField(placeholder, text: $text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(Noct.text48)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("Очистить")
            }
        }
        .noctField()
    }
}

/// Filter chips in a row that scrolls sideways (moderation-filters).
struct TeamFilterBar: View {
    let options: [SegmentOption]
    @Binding var selection: String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options) { option in
                    Button(option.title) {
                        withAnimation(Noct.quick) { selection = option.key }
                    }
                    .buttonStyle(ChipButtonStyle(selected: selection == option.key))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
        }
    }
}

/// An account in a list: avatar, name, @handle and a chip.
struct TeamPersonRow: View {
    let person: Identity
    let subtitle: String
    var trailing: String?
    let status: TeamStatus

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(person: person, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                DisplayName(person: person, size: 15)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text48)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                TeamChip(status: status)
                if let trailing {
                    HStack(spacing: 3) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 10))
                        Text(trailing)
                            .monospacedDigit()
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Noct.gold)
                }
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Color.white.opacity(0.3))
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Noct.card))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Noct.border, lineWidth: 1))
        .contentShape(Rectangle())
    }
}

/// «Показать ещё» under a list that has more.
struct TeamMoreButton: View {
    let loading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if loading {
                ProgressView().tint(.white)
            } else {
                Text("Показать ещё")
            }
        }
        .buttonStyle(SecondaryButtonStyle())
        .disabled(loading)
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }
}

/// The main action of a decision that cannot be undone.
struct DangerButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 18)
            .frame(minHeight: 38)
            .background(Capsule().fill(Noct.red.opacity(configuration.isPressed ? 0.75 : 0.9)))
            .opacity(enabled ? 1 : 0.45)
            .animation(Noct.quick, value: configuration.isPressed)
    }
}

/// A picker as a row with its value on the right (staff-select).
struct TeamChoice: View {
    let title: String
    @Binding var selection: String
    let options: [SegmentOption]

    var body: some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.system(size: 15))
                .foregroundColor(Noct.text60)
            Spacer(minLength: 8)
            Picker(title, selection: $selection) {
                ForEach(options) { option in
                    Text(option.title).tag(option.key)
                }
            }
            .pickerStyle(.menu)
            .tint(.white)
            .labelsHidden()
        }
        .padding(.leading, 14)
        .padding(.trailing, 4)
        .frame(minHeight: 48)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Noct.borderStrong, lineWidth: 1))
    }
}

/// Quiet text inside a card.
struct TeamNote: View {
    let text: String
    var color: Color = Noct.text48

    init(_ text: String, color: Color = Noct.text48) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .foregroundColor(color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The text of reported or held content, set off in a box.
struct TeamEvidence: View {
    let text: String
    var monospaced = false

    var body: some View {
        Text(text)
            .font(monospaced ? .system(size: 13, design: .monospaced) : .system(size: 14))
            .foregroundColor(Noct.text75)
            .lineLimit(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.04)))
    }
}
