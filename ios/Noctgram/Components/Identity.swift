import SwiftUI

/// Round avatar: photo, the Noctgram logo for the official account, or
/// initials on #202020. Premium «Chrome Flow» draws a moving metallic ring.
struct AvatarView: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.displayScale) private var scale
    let person: Identity
    var size: CGFloat = 40
    var ring = true

    var body: some View {
        let chrome = ring && person.appearance.hasDesign && person.appearance.chromeFlow
        ZStack {
            face
                .frame(width: size, height: size)
                .clipShape(Circle())
            if chrome {
                ChromeRing(theme: person.appearance.theme, tempo: person.appearance.chromeTempo, animated: size >= 56)
                    .frame(width: size * 1.152 + 5, height: size * 1.152 + 5)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var face: some View {
        if let url = session.api.mediaURL(person.avatar) {
            RemoteImage(url: url, maxPixel: size * scale, placeholder: Noct.avatarFill)
        } else if person.id == "noctgram" {
            ZStack {
                Noct.avatarFill
                Image("Logo").resizable().scaledToFit().padding(size * 0.12)
            }
        } else {
            ZStack {
                Noct.avatarFill
                Text(Format.initials(person.name))
                    .font(.system(size: size / 2.8, weight: .medium))
                    .foregroundColor(Noct.text75)
            }
        }
    }
}

/// Metallic moving ring (profile-design.css .chrome-flow-frame).
struct ChromeRing: View {
    let theme: ProfileTheme
    var tempo: Double = 11
    var animated = true
    @State private var angle: Double = 0

    var body: some View {
        let dark = Color(hex: 0x17171D)
        let light = theme.second.opacity(0.62)
        GeometryReader { geometry in
            let width = max(2, geometry.size.width * 0.036)
            Circle()
                .strokeBorder(
                    AngularGradient(
                        colors: [.white, light, dark, theme.first, .white, light, dark, theme.first, .white],
                        center: .center,
                        angle: .degrees(angle)
                    ),
                    lineWidth: width
                )
        }
        .onAppear {
            guard animated else { return }
            let seconds = min(26, max(3, tempo)) * 0.75
            withAnimation(.linear(duration: seconds).repeatForever(autoreverses: false)) {
                angle = 360
            }
        }
    }
}

/// The large profile avatar: 96 pt, optional rotating text ring around it.
struct ProfileAvatar: View {
    let person: Identity
    var size: CGFloat = 96
    var bordered = true

    var body: some View {
        let ring = person.appearance.hasDesign ? person.appearance.ringText.trimmingCharacters(in: .whitespaces) : ""
        ZStack {
            AvatarView(person: person, size: size)
                .overlay(
                    Circle()
                        .stroke(ring.isEmpty ? Noct.background : person.appearance.theme.first, lineWidth: ring.isEmpty ? (bordered ? 4 : 0) : 2)
                )
            if !ring.isEmpty {
                RingText(text: ring, theme: person.appearance.theme, radius: size * 0.73 * (person.appearance.chromeFlow ? 1.1 : 1))
            }
        }
        .frame(width: size, height: size)
        .padding(ring.isEmpty ? 0 : size * 0.2)
    }
}

/// Text orbiting the avatar once every 24 s (SVG textPath on the web).
struct RingText: View {
    let text: String
    let theme: ProfileTheme
    let radius: CGFloat
    @State private var rotation: Double = 0

    var body: some View {
        let characters = Array((text.uppercased() + " · "))
        let count = max(characters.count, 1)
        ZStack {
            ForEach(Array(characters.enumerated()), id: \.offset) { index, character in
                Text(String(character))
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [theme.first, theme.second],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .offset(y: -radius)
                    .rotationEffect(.degrees(Double(index) / Double(count) * 360))
            }
        }
        .rotationEffect(.degrees(rotation))
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.linear(duration: 24).repeatForever(autoreverses: false)) {
                rotation = 360
            }
        }
    }
}

/// Premium star tinted with the profile palette (CSS mask on the web).
struct PremiumBadge: View {
    let appearance: Appearance
    var size: CGFloat = 16

    var body: some View {
        Image("PremiumBadge")
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .foregroundStyle(appearance.theme.gradient)
            .frame(width: size, height: size)
            .accessibilityLabel("Noct Premium")
    }
}

/// Crowned badge of an account confirmed by Noctgram.
struct VerifiedBadge: View {
    let appearance: Appearance
    var size: CGFloat = 16

    var body: some View {
        Image("VerifiedBadge")
            .resizable()
            .renderingMode(.template)
            .scaledToFit()
            .foregroundStyle(appearance.theme.gradient)
            .frame(width: size, height: size)
            .accessibilityLabel("Подтверждённый аккаунт")
    }
}

/// Name with the Premium gradient, boosted channel colour and badges.
struct DisplayName: View {
    let person: Identity
    var size: CGFloat = 15
    var weight: Font.Weight = .semibold
    var tracking: CGFloat = 0

    var body: some View {
        let look = person.appearance
        HStack(spacing: max(4, size * 0.22)) {
            styledName(look)
                .font(.system(size: size, weight: weight))
                .tracking(tracking)
                .lineLimit(1)
            if look.verified {
                VerifiedBadge(appearance: look, size: size * 1.05)
            }
            if look.premium {
                PremiumBadge(appearance: look, size: max(14, size * 1.02))
            }
        }
    }

    @ViewBuilder private func styledName(_ look: Appearance) -> some View {
        if look.hasDesign && look.nameGradient {
            Text(person.name).foregroundStyle(
                LinearGradient(colors: [look.theme.first, look.theme.second], startPoint: .leading, endPoint: .trailing)
            )
        } else if look.boostLevel > 0 {
            Text(person.name).foregroundColor(look.theme.first)
        } else {
            Text(person.name).foregroundColor(.white)
        }
    }
}

/// «Канал» chip next to channel names.
struct ChannelLabel: View {
    var appearance = Appearance()

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "megaphone")
                .font(.system(size: 11, weight: .medium))
            Text("Канал")
                .font(.system(size: 12, weight: .medium))
        }
        .foregroundColor(appearance.boostLevel > 0 ? appearance.theme.first : Noct.text60)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Capsule().fill(Noct.fill))
    }
}

/// A row with avatar, name and @handle used by lists (followers, search).
struct PersonRow: View {
    let person: Identity
    var subtitle: String?
    var avatarSize: CGFloat = 44

    var body: some View {
        HStack(spacing: 12) {
            AvatarView(person: person, size: avatarSize)
            VStack(alignment: .leading, spacing: 2) {
                DisplayName(person: person, size: 15)
                Text(subtitle ?? "@" + person.handle)
                    .font(.system(size: 13))
                    .foregroundColor(Noct.text48)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
    }
}
