import AVFoundation
import SwiftUI
import UIKit

/// A voice message inside its bubble, as in Telegram: the round play
/// button, the waveform that fills as it plays (a tap or a drag on it seeks),
/// the time with a dot until it is listened to, and the speed once it plays.
struct VoiceMessageView: View {
    @EnvironmentObject private var session: AppSession
    @ObservedObject private var playback = VoicePlayback.shared
    let attachment: ChatAttachment
    let accent: Color
    let mine: Bool
    /// Nobody has listened to it yet (the dot after the time).
    var unheard = false
    /// Called on the first play (listened marks).
    var onPlay: (() -> Void)?

    private var current: Bool { playback.current == attachment.id }
    private var playing: Bool { current && playback.playing }
    private var duration: Double { current && playback.duration > 0 ? playback.duration : attachment.duration }
    private var bars: [Int] {
        Waveform.resample(attachment.waveform.isEmpty ? Array(repeating: 2, count: 24) : attachment.waveform,
                          bars: Waveform.barCount(duration: attachment.duration))
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Button(action: toggle) {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(mine ? Color.black.opacity(0.78) : Color.black.opacity(0.8))
                    .offset(x: playing ? 0 : 1.5)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(accent))
                    .contentShape(Circle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityIdentifier("voice-play-" + attachment.id)
            .accessibilityLabel(playing ? "Пауза" : "Слушать голосовое сообщение")
            VStack(alignment: .leading, spacing: 5) {
                WaveformBars(values: bars, progress: current ? playback.progress : 0, accent: accent, mine: mine) { fraction in
                    if current {
                        playback.seek(attachment.id, to: fraction)
                    } else {
                        toggle()
                        playback.seek(attachment.id, to: fraction)
                    }
                }
                HStack(spacing: 5) {
                    Text(Waveform.clock(current && playback.time > 0 ? playback.time : duration))
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundColor(mine ? Color.white.opacity(0.6) : Noct.text48)
                    if playback.failed.contains(attachment.id), let url = session.api.mediaURL(attachment.path + "?download=1") {
                        // A browser's WebM or Ogg: iOS does not play it here.
                        Link("Скачать", destination: url)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(accent)
                    }
                    if unheard {
                        Circle().fill(accent).frame(width: 5, height: 5)
                    }
                    if current {
                        Button {
                            playback.cycleSpeed()
                        } label: {
                            Text(speedLabel)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(accent)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(accent.opacity(0.18)))
                        }
                        .buttonStyle(PressableStyle())
                        .accessibilityLabel("Скорость \(speedLabel)")
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var speedLabel: String {
        playback.speed == 1.5 ? "1,5×" : (playback.speed == 2 ? "2×" : "1×")
    }

    private func toggle() {
        guard let url = session.api.mediaURL(attachment.path) else { return }
        if !current { onPlay?() }
        playback.toggle(attachment.id, url: url, duration: attachment.duration)
    }
}

/// Bars of a waveform, 2 pt wide with a 2 pt gap; the played part is lit.
struct WaveformBars: View {
    let values: [Int]
    let progress: Double
    let accent: Color
    let mine: Bool
    let seek: (Double) -> Void

    private let bar: CGFloat = 2.5
    private let gap: CGFloat = 1.5

    var body: some View {
        let width = CGFloat(values.count) * (bar + gap) - gap
        Canvas { context, size in
            let lit = size.width * CGFloat(progress)
            for (index, value) in values.enumerated() {
                let x = CGFloat(index) * (bar + gap)
                let height = 3 + CGFloat(value) / 31 * (size.height - 3)
                let rect = CGRect(x: x, y: size.height - height, width: bar, height: height)
                let path = Path(roundedRect: rect, cornerRadius: bar / 2)
                context.fill(path, with: .color(x < lit ? accent : (mine ? Color.white.opacity(0.35) : Color.white.opacity(0.28))))
            }
        }
        .frame(width: width, height: 22)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onEnded { value in seek(max(0, min(1, value.location.x / width))) }
        )
        .accessibilityHidden(true)
    }
}

/// A round video message without a bubble, as in Telegram and the web
/// (app/round-video-message.tsx): a silent loop while it is on screen; a
/// tap plays it from the start with sound and a ring of progress, another
/// pauses, and at the end it goes back to the silent loop.
struct RoundMessageView: View {
    @EnvironmentObject private var session: AppSession
    let attachment: ChatAttachment
    let accent: Color
    var unheard = false
    var onPlay: (() -> Void)?
    @StateObject private var model = RoundPlayback()

    static let side: CGFloat = 240

    var body: some View {
        ZStack {
            RoundPlayerSurface(player: model.player)
                .frame(width: Self.side, height: Self.side)
                .background(Circle().fill(Noct.coverFill))
                .clipShape(Circle())
                .overlay {
                    if let poster = model.poster, !model.showingVideo {
                        Image(uiImage: poster)
                            .resizable()
                            .scaledToFill()
                            .frame(width: Self.side, height: Self.side)
                            .clipShape(Circle())
                    }
                }
            if model.withSound {
                Circle()
                    .trim(from: 0, to: CGFloat(model.progress))
                    .stroke(Color.white, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .frame(width: Self.side - 8, height: Self.side - 8)
            }
            if !model.withSound {
                Image(systemName: "speaker.slash.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(Color.black.opacity(0.45)))
                    .position(x: Self.side / 2, y: Self.side - 22)
            }
        }
        .frame(width: Self.side, height: Self.side)
        .scaleEffect(model.withSound ? 1.05 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: model.withSound)
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: 4) {
                Text(Waveform.clock(model.withSound ? max(0, (model.duration > 0 ? model.duration : attachment.duration) - model.time) : attachment.duration))
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                if unheard { Circle().fill(accent).frame(width: 5, height: 5) }
            }
            .foregroundColor(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color.black.opacity(0.45)))
            .padding(.leading, 6)
        }
        .contentShape(Circle())
        .onTapGesture {
            if !model.withSound { onPlay?() }
            model.tap()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Видеосообщение, \(Waveform.clock(attachment.duration))")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("round-" + attachment.id)
        .onAppear {
            model.configure(url: session.api.mediaURL(attachment.path), id: attachment.id)
            model.visible(true)
        }
        .onDisappear { model.visible(false) }
    }
}

/// The player of one round message: a muted loop, or the sound playback
/// started by a tap (one sound at a time, shared with voice messages).
@MainActor
final class RoundPlayback: ObservableObject {
    let player = AVQueuePlayer()
    @Published private(set) var withSound = false
    @Published private(set) var time: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var poster: UIImage?
    @Published private(set) var showingVideo = false

    private var url: URL?
    private var id = ""
    private var looper: AVPlayerLooper?
    private var item: AVPlayerItem?
    private var timeToken: Any?
    private var endToken: NSObjectProtocol?
    private var statusToken: NSKeyValueObservation?
    private var onScreen = false

    var progress: Double { duration > 0 ? min(1, time / duration) : 0 }

    func configure(url: URL?, id: String) {
        guard self.url == nil, let url else { return }
        self.url = url
        self.id = id
        player.isMuted = true
        player.preventsDisplaySleepDuringVideoPlayback = false
        timeToken = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 20), queue: .main) { [weak self] time in
            let seconds = time.seconds
            Task { @MainActor in
                // The silent loop shows the whole length; only playback
                // with sound moves the ring.
                guard let self, self.withSound, seconds.isFinite else { return }
                self.time = seconds
            }
        }
        statusToken = player.observe(\.timeControlStatus, options: [.new]) { [weak self] player, _ in
            let started = player.timeControlStatus == .playing
            Task { @MainActor in
                if started { self?.showingVideo = true }
            }
        }
        Task {
            poster = await VideoThumbnails.shared.thumbnail(for: url)
        }
    }

    func visible(_ value: Bool) {
        onScreen = value
        if value {
            if !withSound { loop() }
        } else {
            stopSound()
            player.pause()
            looper?.disableLooping()
            looper = nil
            player.removeAllItems()
            showingVideo = false
        }
    }

    /// Plays silently in a loop while on screen; not with Reduce Motion.
    private func loop() {
        guard let url, onScreen, !UIAccessibility.isReduceMotionEnabled else { return }
        player.isMuted = true
        if looper == nil {
            let item = AVPlayerItem(asset: AuthorizedAsset.asset(url))
            player.removeAllItems()
            looper = AVPlayerLooper(player: player, templateItem: item)
        }
        player.play()
    }

    func tap() {
        guard let url else { return }
        if withSound {
            if player.timeControlStatus == .paused {
                VoicePlayback.shared.claim(id) { [weak self] in self?.stopSound() }
                player.play()
            } else {
                player.pause()
            }
            return
        }
        // From the start with sound, once.
        VoicePlayback.shared.claim(id) { [weak self] in self?.stopSound() }
        looper?.disableLooping()
        looper = nil
        player.removeAllItems()
        let item = AVPlayerItem(asset: AuthorizedAsset.asset(url))
        self.item = item
        player.insert(item, after: nil)
        player.isMuted = false
        withSound = true
        time = 0
        endToken = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.stopSound() }
        }
        Task {
            if let seconds = try? await item.asset.load(.duration).seconds, seconds.isFinite { duration = seconds }
        }
        player.play()
    }

    /// Back to the silent loop.
    func stopSound() {
        guard withSound else { return }
        withSound = false
        if let endToken { NotificationCenter.default.removeObserver(endToken) }
        endToken = nil
        item = nil
        player.pause()
        player.removeAllItems()
        VoicePlayback.shared.release(id)
        PlaybackAudio.end()
        loop()
    }

    deinit {
        if let timeToken { player.removeTimeObserver(timeToken) }
        if let endToken { NotificationCenter.default.removeObserver(endToken) }
    }
}

/// The picture of a round video, filling its circle.
struct RoundPlayerSurface: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = .resizeAspectFill
        view.backgroundColor = .clear
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {}
}
