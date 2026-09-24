import SwiftUI

/// «Слушает музыку» card of the profile (app/music-activity.tsx): the track,
/// who listens together and a live position. Refreshed every 10 s.
struct MusicActivityCard: View {
    @EnvironmentObject private var session: AppSession
    @EnvironmentObject private var nav: Navigator
    @Environment(\.openURL) private var openURL
    let profile: Profile

    @State private var activity: MusicActivity?
    /// Server time minus local time at the last response.
    @State private var offset: Double = 0

    var body: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 0)
            if let activity {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let now = context.date.timeIntervalSince1970 * 1000 + offset
                    if activity.expiresAt > now {
                        card(activity, now: now)
                            .padding(.top, 14)
                    }
                }
            }
        }
        .task(id: profile.id) {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 10_000_000_000)
            }
        }
    }

    private func load() async {
        guard let data = try? await session.api.get("/api/music/activity", ["id": profile.id]) else { return }
        if let server = data["serverTime"].double {
            offset = server - Date().timeIntervalSince1970 * 1000
        }
        withAnimation(Noct.quick) { activity = MusicActivity(data["activity"]) }
    }

    private var colors: [Color] {
        let look = profile.appearance
        if look.premium && profile.background.musicColor == "profile" {
            return [look.theme.first, look.theme.second]
        }
        return [Color(hex: 0x9897AC), Color(hex: 0x777889)]
    }

    private func card(_ activity: MusicActivity, now: Double) -> some View {
        let companions = activity.companions.filter { $0.expiresAt > now }
        let together = !companions.isEmpty
        let position = activity.position(at: now)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                if activity.playing {
                    EqualizerMark(color: colors[0])
                } else {
                    Image(systemName: "pause.fill").font(.system(size: 11, weight: .bold))
                }
                Text(activity.playing
                     ? (together ? "Слушает вместе с" : "Слушает музыку")
                     : (together ? "На паузе вместе с" : "На паузе"))
                    .font(.system(size: 12, weight: .semibold))
                ForEach(companions.prefix(2), id: \.identity.id) { companion in
                    Button {
                        nav.push(.profile(companion.identity.id))
                    } label: {
                        HStack(spacing: 5) {
                            AvatarView(person: companion.identity, size: 18, ring: false)
                            Text(companion.identity.name)
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(PressableStyle())
                }
                if companions.count > 2 {
                    Text("+\(companions.count - 2)").font(.system(size: 12, weight: .medium))
                }
            }
            .foregroundColor(colors[0])

            Button {
                if let url = URL(string: activity.trackUrl) { openURL(url) }
            } label: {
                HStack(spacing: 12) {
                    ZStack {
                        Noct.fillStrong
                        if let url = URL(string: activity.largeArtwork), url.scheme == "https" {
                            RemoteImage(url: url, maxPixel: 200, placeholder: .clear)
                        } else {
                            Image(systemName: "music.note").foregroundColor(Noct.text60)
                        }
                    }
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(activity.title)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .lineLimit(1)
                        Text(activity.artist)
                            .font(.system(size: 13))
                            .foregroundColor(Noct.text75)
                            .lineLimit(1)
                        Text(activity.providerName)
                            .font(.system(size: 11))
                            .foregroundColor(Noct.text48)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: 26))
                        .foregroundColor(.white.opacity(0.85))
                }
            }
            .buttonStyle(PressableStyle())

            if activity.durationMs > 0 {
                VStack(spacing: 4) {
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.12))
                            Capsule()
                                .fill(LinearGradient(colors: colors, startPoint: .leading, endPoint: .trailing))
                                .frame(width: geometry.size.width * CGFloat(position / activity.durationMs))
                        }
                    }
                    .frame(height: 3)
                    HStack {
                        Text(MusicActivity.time(position))
                        Spacer()
                        Text(MusicActivity.time(activity.durationMs))
                    }
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundColor(Noct.text48)
                }
            }
        }
        .padding(14)
        .background(
            ZStack {
                LinearGradient(colors: [colors[0].opacity(0.16), colors[1].opacity(0.06)], startPoint: .topLeading, endPoint: .bottomTrailing)
                if profile.background.musicColor != "profile", let url = URL(string: activity.largeArtwork), url.scheme == "https" {
                    RemoteImage(url: url, maxPixel: 200, placeholder: .clear)
                        .blur(radius: 40)
                        .opacity(0.25)
                }
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Noct.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Музыкальная активность: \(activity.title), \(activity.artist)")
    }
}

/// Three bars that bounce while music plays.
private struct EqualizerMark: View {
    let color: Color
    @State private var up = false

    var body: some View {
        let heights: [CGFloat] = up ? [11, 6, 9] : [4, 10, 5]
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<3, id: \.self) { index in
                Capsule()
                    .fill(color)
                    .frame(width: 3, height: heights[index])
            }
        }
        .frame(height: 12, alignment: .bottom)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.45).repeatForever(autoreverses: true)) { up = true }
        }
    }
}
