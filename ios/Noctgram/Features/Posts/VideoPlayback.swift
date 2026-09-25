import AVFoundation
import AVKit
import SwiftUI
import UIKit

/// One video of the media viewer: the player, its time, what is loaded and
/// how fast it plays, plus picture in picture. Controls are drawn by
/// VideoControls; the picture by PlayerSurface.
@MainActor
final class VideoPlayback: ObservableObject {
    let player = AVPlayer()
    @Published private(set) var time: Double = 0
    @Published private(set) var duration: Double = 0
    /// The end of what is loaded around the current time.
    @Published private(set) var loaded: Double = 0
    /// Playing or waiting for data to play.
    @Published private(set) var playing = false
    @Published private(set) var waiting = false
    @Published private(set) var failed = false
    @Published private(set) var bytes: Int?
    @Published private(set) var inPictureInPicture = false
    @Published var speed: Float = 1 {
        didSet {
            player.defaultRate = speed
            if player.rate > 0 { player.rate = speed }
        }
    }
    /// Called when picture in picture takes the video (the viewer closes).
    var onPictureInPicture: (() -> Void)?

    private let url: URL
    private var ended = false
    private var scrubbing = false
    private var timeToken: Any?
    private var observations: [NSKeyValueObservation] = []
    private var endToken: NSObjectProtocol?
    private var pictureInPicture: AVPictureInPictureController?
    private let pictureDelegate = PictureInPictureDelegate()
    /// Kept while picture in picture shows the layer after the viewer closed.
    private var surface: PlayerView?

    init(url: URL, bytes: Int?) {
        self.url = url
        self.bytes = bytes
        let item = AVPlayerItem(asset: AuthorizedAsset.asset(url))
        player.replaceCurrentItem(with: item)
        player.actionAtItemEnd = .pause
        timeToken = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 10), queue: .main) { [weak self] time in
            let seconds = time.seconds
            Task { @MainActor in self?.tick(seconds) }
        }
        observations.append(player.observe(\.timeControlStatus, options: [.initial, .new]) { [weak self] player, _ in
            let status = player.timeControlStatus
            Task { @MainActor in
                self?.playing = status != .paused
                self?.waiting = status == .waitingToPlayAtSpecifiedRate
            }
        })
        observations.append(item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let failed = item.status == .failed
            Task { @MainActor in self?.failed = failed }
        })
        endToken = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.ended = true }
        }
        pictureDelegate.started = { [weak self] in self?.pictureStarted() }
        pictureDelegate.stopped = { [weak self] in self?.pictureStopped() }
        Task { [weak self] in await self?.loadInfo(item) }
    }

    deinit {
        if let timeToken { player.removeTimeObserver(timeToken) }
        if let endToken { NotificationCenter.default.removeObserver(endToken) }
    }

    func play() {
        if ended || (duration > 0 && time >= duration - 0.05) { seek(to: 0) }
        ended = false
        player.defaultRate = speed
        player.play()
    }

    func pause() {
        player.pause()
    }

    func toggle() {
        if playing { pause() } else { play() }
    }

    func skip(_ seconds: Double) {
        seek(to: time + seconds)
    }

    func seek(to seconds: Double, exact: Bool = true) {
        let target = max(0, duration > 0 ? min(seconds, duration) : seconds)
        time = target
        ended = false
        let tolerance = exact ? CMTime.zero : CMTime(seconds: 0.25, preferredTimescale: 600)
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: tolerance, toleranceAfter: tolerance)
    }

    /// Dragging the seek bar: the picture follows, the clock stays put.
    func scrub(to fraction: Double) {
        scrubbing = true
        seek(to: fraction * duration, exact: false)
    }

    func endScrub(at fraction: Double) {
        seek(to: fraction * duration)
        scrubbing = false
    }

    var canPictureInPicture: Bool {
        AVPictureInPictureController.isPictureInPictureSupported()
    }

    func togglePictureInPicture() {
        guard let pictureInPicture else { return }
        if pictureInPicture.isPictureInPictureActive {
            pictureInPicture.stopPictureInPicture()
        } else {
            if !playing { play() }
            pictureInPicture.startPictureInPicture()
        }
    }

    /// The layer PlayerSurface draws into; picture in picture takes it
    /// from there, also when the app goes to the background.
    fileprivate func attach(_ view: PlayerView) {
        guard pictureInPicture == nil, canPictureInPicture,
              let controller = AVPictureInPictureController(playerLayer: view.playerLayer) else { return }
        controller.delegate = pictureDelegate
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        pictureInPicture = controller
        surface = view
    }

    private func tick(_ seconds: Double) {
        guard seconds.isFinite else { return }
        if !scrubbing { time = seconds }
        let ranges = player.currentItem?.loadedTimeRanges.map(\.timeRangeValue) ?? []
        let around = ranges.first { $0.start.seconds <= seconds + 0.5 && seconds <= $0.end.seconds + 0.5 }
        loaded = around?.end.seconds ?? loaded
    }

    private func loadInfo(_ item: AVPlayerItem) async {
        if let value = try? await item.asset.load(.duration), value.seconds.isFinite, value.seconds > 0 {
            duration = value.seconds
        }
        guard bytes == nil else { return }
        // The size, as Telegram shows it, from a HEAD request.
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        if let answer = try? await URLSession.shared.data(for: request),
           let http = answer.1 as? HTTPURLResponse, http.statusCode < 300,
           let length = http.value(forHTTPHeaderField: "Content-Length").flatMap(Int.init), length > 0 {
            bytes = length
        }
    }

    private func pictureStarted() {
        inPictureInPicture = true
        PictureInPictureKeeper.hold(self)
        onPictureInPicture?()
    }

    private func pictureStopped() {
        inPictureInPicture = false
        PictureInPictureKeeper.release(self)
    }
}

/// Keeps a video playing in picture in picture after its viewer closed.
@MainActor
enum PictureInPictureKeeper {
    private static var held: [VideoPlayback] = []

    static var active: Bool { !held.isEmpty }

    static func hold(_ playback: VideoPlayback) {
        if !held.contains(where: { $0 === playback }) { held.append(playback) }
    }

    static func release(_ playback: VideoPlayback) {
        held.removeAll { $0 === playback }
        if held.isEmpty { PlaybackAudio.end() }
    }
}

/// AVKit calls the delegate on the main thread; the playback hears it here.
private final class PictureInPictureDelegate: NSObject, AVPictureInPictureControllerDelegate {
    var started: (@MainActor () -> Void)?
    var stopped: (@MainActor () -> Void)?

    func pictureInPictureControllerDidStartPictureInPicture(_ controller: AVPictureInPictureController) {
        let started = started
        Task { @MainActor in started?() }
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ controller: AVPictureInPictureController) {
        let stopped = stopped
        Task { @MainActor in stopped?() }
    }

    func pictureInPictureController(_ controller: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }
}

/// Sound of videos plays with the ring switch off, as in Telegram; other
/// apps get their sound back when the viewer closes.
enum PlaybackAudio {
    static func begin() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .moviePlayback)
        try? session.setActive(true)
    }

    @MainActor
    static func end() {
        guard !PictureInPictureKeeper.active else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        try? session.setCategory(.soloAmbient)
    }
}

final class PlayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

/// The picture of a video, fitted to the screen.
struct PlayerSurface: UIViewRepresentable {
    let playback: VideoPlayback

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.backgroundColor = .black
        view.playerLayer.videoGravity = .resizeAspect
        view.playerLayer.player = playback.player
        playback.attach(view)
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {}
}

/// The app stays upright (AppDelegate); the full-screen button of a video
/// turns the viewer to landscape and back, as in Telegram. UIKit is asked
/// about orientations only then, never while the viewer comes or goes: a
/// presentation interrupted by such a question could leave an invisible
/// layer over the app that swallowed every tap.
@MainActor
enum ViewerOrientation {
    static var isLandscape: Bool { scene?.interfaceOrientation.isLandscape == true }

    /// Upright only, if full screen had turned it; otherwise nothing.
    static func lock() {
        guard AppDelegate.orientations != .portrait || isLandscape else { return }
        AppDelegate.orientations = .portrait
        refresh()
        if isLandscape {
            scene?.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
        }
    }

    /// The full-screen button: landscape, or back to portrait. While in
    /// landscape the viewer also turns with the phone.
    static func toggleLandscape() {
        guard let scene else { return }
        if isLandscape {
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
            // Upright only once it has turned back.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                guard !isLandscape else { return }
                AppDelegate.orientations = .portrait
                refresh()
            }
        } else {
            AppDelegate.orientations = .allButUpsideDown
            refresh()
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
        }
    }

    private static var scene: UIWindowScene? {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    }

    private static func refresh() {
        for window in scene?.windows ?? [] {
            var controller = window.rootViewController
            while let current = controller {
                current.setNeedsUpdateOfSupportedInterfaceOrientations()
                controller = current.presentedViewController
            }
        }
    }
}

/// Files handed to the share sheet or saved to Photos.
enum MediaFiles {
    static func download(_ url: URL, name: String) async -> URL? {
        guard let download = try? await URLSession.shared.download(from: url),
              ((download.1 as? HTTPURLResponse)?.statusCode ?? 200) < 300 else { return nil }
        let temporary = download.0
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let safe = name.replacingOccurrences(of: "/", with: "-")
        let target = folder.appendingPathComponent(safe.isEmpty ? "video.mp4" : safe)
        try? FileManager.default.removeItem(at: target)
        do {
            try FileManager.default.moveItem(at: temporary, to: target)
        } catch {
            return nil
        }
        return target
    }
}

struct SharedMedia: Identifiable {
    let id = UUID()
    let items: [Any]
}

/// The system share sheet.
struct ActivityView: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
