import AVFoundation
import SwiftUI

/// Voice messages play one at a time, as in Telegram: starting one stops
/// the one before, and so does a round video that starts with sound. The
/// speed (1×, 1,5×, 2×) carries over to the next message.
@MainActor
final class VoicePlayback: ObservableObject {
    static let shared = VoicePlayback()

    /// The attachment playing or paused on its place.
    @Published private(set) var current: String?
    @Published private(set) var playing = false
    @Published private(set) var time: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var speed: Float = 1
    /// Called once a message has been played through (listened marks).
    var onEnded: ((String) -> Void)?

    private var player: AVPlayer?
    private var timeToken: Any?
    private var endToken: NSObjectProtocol?
    private var statusToken: NSKeyValueObservation?
    /// Whoever else holds the sound (a round video) and how to stop it.
    private var other: (id: String, stop: () -> Void)?

    var progress: Double { duration > 0 ? min(1, time / duration) : 0 }

    func toggle(_ id: String, url: URL, duration known: Double) {
        if current == id, let player {
            if playing {
                player.pause()
            } else {
                claimSound(for: id)
                if duration > 0 && time >= duration - 0.05 { seek(id, to: 0) }
                player.playImmediately(atRate: speed)
            }
            return
        }
        start(id, url: url, duration: known)
    }

    private func start(_ id: String, url: URL, duration known: Double) {
        stop()
        claimSound(for: id)
        let item = AVPlayerItem(asset: AuthorizedAsset.asset(url))
        let player = AVPlayer(playerItem: item)
        player.automaticallyWaitsToMinimizeStalling = true
        self.player = player
        current = id
        time = 0
        duration = known
        timeToken = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] time in
            let seconds = time.seconds
            Task { @MainActor in
                guard let self, self.current == id else { return }
                if seconds.isFinite { self.time = seconds }
            }
        }
        statusToken = player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            let status = player.timeControlStatus
            Task { @MainActor in
                guard let self, self.current == id else { return }
                self.playing = status != .paused
            }
        }
        endToken = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.ended(id) }
        }
        Task { [weak self] in
            guard let seconds = try? await item.asset.load(.duration).seconds, seconds.isFinite, seconds > 0 else { return }
            await MainActor.run {
                guard let self, self.current == id else { return }
                self.duration = seconds
            }
        }
        player.playImmediately(atRate: speed)
    }

    private func ended(_ id: String) {
        guard current == id else { return }
        time = duration
        playing = false
        onEnded?(id)
        stop()
    }

    func seek(_ id: String, to fraction: Double) {
        guard current == id, let player, duration > 0 else { return }
        let target = max(0, min(1, fraction)) * duration
        time = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    /// 1× → 1,5× → 2× → 1×.
    func cycleSpeed() {
        speed = speed == 1 ? 1.5 : (speed == 1.5 ? 2 : 1)
        if let player, playing { player.rate = speed }
    }

    func stop() {
        if let timeToken, let player { player.removeTimeObserver(timeToken) }
        if let endToken { NotificationCenter.default.removeObserver(endToken) }
        statusToken?.invalidate()
        player?.pause()
        player = nil
        timeToken = nil
        endToken = nil
        statusToken = nil
        current = nil
        playing = false
        time = 0
        PlaybackAudio.end()
    }

    /// A round video takes the sound: the voice pauses, and the round
    /// stops when a voice message or another round starts.
    func claim(_ id: String, stop: @escaping () -> Void) {
        if let other, other.id != id { other.stop() }
        if current != nil { self.stop() }
        other = (id, stop)
        PlaybackAudio.begin()
    }

    func release(_ id: String) {
        if other?.id == id { other = nil }
    }

    private func claimSound(for id: String) {
        if let other, other.id != id { other.stop() }
        other = nil
        PlaybackAudio.begin()
    }
}
