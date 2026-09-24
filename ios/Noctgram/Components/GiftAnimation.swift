import Lottie
import SwiftUI
import UIKit
import os

/// Lottie animations of gifts, the same files the web plays
/// (lib/gift-animation-runtime.ts): /assets/gifts/<id>.json for catalog
/// gifts and gzipped /assets/gifts/collectible-*.tgs for collectibles.
@MainActor
final class GiftAnimations {
    static let shared = GiftAnimations()

    /// Decoded off the main thread and handed back in a box.
    private final class Box: @unchecked Sendable {
        let animation: LottieAnimation
        init(_ animation: LottieAnimation) { self.animation = animation }
    }

    private var cache: [URL: LottieAnimation] = [:]
    private var order: [URL] = []
    private var running: [URL: Task<Box?, Never>] = [:]

    /// The animation next to a static `/assets/gifts/<name>.webp`.
    static func animationPath(forArt path: String) -> String? {
        guard path.hasPrefix("/assets/gifts/"), path.hasSuffix(".webp") else { return nil }
        let name = String(path.dropFirst("/assets/gifts/".count).dropLast(".webp".count))
        guard !name.isEmpty else { return nil }
        return "/assets/gifts/" + name + (name.hasPrefix("collectible-") ? ".tgs" : ".json")
    }

    /// Downloads (disk-cached) and decodes off the main thread; the last 16
    /// decoded animations stay in memory.
    func animation(for url: URL) async -> LottieAnimation? {
        if let hit = cache[url] { return hit }
        if let task = running[url] { return await task.value?.animation }
        let task = Task.detached(priority: .utility) { () -> Box? in
            guard var data = await ImagePipeline.shared.data(for: url) else { return nil }
            if url.pathExtension == "tgs" {
                guard let json = Gzip.inflate(data) else { return nil }
                data = json
            }
            return (try? LottieAnimation.from(data: data)).map(Box.init)
        }
        running[url] = task
        let box = await task.value
        running[url] = nil
        guard let animation = box?.animation else { return nil }
        cache[url] = animation
        order.removeAll { $0 == url }
        order.append(url)
        if order.count > 16 { cache[order.removeFirst()] = nil }
        return animation
    }
}

/// Decides which gift animations play, like lib/gift-animation-runtime.ts:
/// a few at once (the topmost on screen, or only the open gift card), only
/// after scrolling settles, never with Reduce Motion. The rest show their
/// static picture, and a player that stops frees its Lottie layers.
@MainActor
final class GiftPlayback: NSObject {
    static let shared = GiftPlayback()

    private let limit = 3
    private let settle: CFTimeInterval = 0.25
    private var players: [GiftPlayerView] = []
    private var link: CADisplayLink?
    #if DEBUG
    /// The CI screenshot job prints these lines to check the limit.
    private let log = Logger(subsystem: "com.noctgram.ios", category: "gifts")
    private var summary = ""
    #endif

    func register(_ player: GiftPlayerView) {
        if !players.contains(where: { $0 === player }) { players.append(player) }
        if link == nil {
            let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 4, maximum: 8, preferred: 6)
            link.add(to: .main, forMode: .common)
            self.link = link
        }
        rebalance()
    }

    func unregister(_ player: GiftPlayerView) {
        players.removeAll { $0 === player }
        player.stop()
        if players.isEmpty {
            link?.invalidate()
            link = nil
        } else {
            rebalance()
        }
    }

    @objc private func tick(_ link: CADisplayLink) {
        rebalance()
    }

    private func rebalance() {
        let now = CACurrentMediaTime()
        var visible: [GiftPlayerView] = []
        for player in players where player.observe(now) {
            visible.append(player)
        }
        var chosen: [GiftPlayerView] = []
        if !UIAccessibility.isReduceMotionEnabled {
            let featured = visible.filter(\.featured)
            // An open gift card plays alone; the grid under it rests.
            let pool = featured.isEmpty ? visible.filter { now - $0.stillSince >= settle } : featured
            chosen = Array(pool.sorted { a, b in
                abs(a.screenFrame.minY - b.screenFrame.minY) > 1 ? a.screenFrame.minY < b.screenFrame.minY : a.screenFrame.minX < b.screenFrame.minX
            }.prefix(limit))
        }
        for player in players {
            if chosen.contains(where: { $0 === player }) { player.play() } else { player.stop() }
        }
        #if DEBUG
        let next = "playing \(chosen.count) of \(visible.count) visible (\(visible.filter(\.featured).count) featured), \(players.count) registered"
        if next != summary {
            summary = next
            log.notice("\(next, privacy: .public)")
        }
        #endif
    }
}

/// Static gift art that turns into its Lottie animation while GiftPlayback
/// lets it play.
final class GiftPlayerView: UIView {
    private let imageView = UIImageView()
    private var lottieView: LottieAnimationView?
    private var artURL: URL?
    private var animationURL: URL?
    private var loaded: LottieAnimation?
    private var imageTask: Task<Void, Never>?
    private var animationTask: Task<Void, Never>?
    private var wantsPlay = false
    private var registered = false
    private var lastFrame = CGRect.null
    /// Steps an animation that Lottie can only draw on the main thread.
    private var stepper: CADisplayLink?
    private var steppedSince: CFTimeInterval = 0

    private(set) var featured = false
    private(set) var screenFrame = CGRect.null
    private(set) var stillSince: CFTimeInterval = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        imageView.contentMode = .scaleAspectFit
        imageView.frame = bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(imageView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func configure(art: URL?, animation: URL?, featured: Bool) {
        self.featured = featured
        if art != artURL {
            artURL = art
            imageTask?.cancel()
            imageView.image = art.flatMap { ImagePipeline.shared.cached($0, maxPixel: 360) }
            if let art, imageView.image == nil {
                imageTask = Task { [weak self] in
                    let image = await ImagePipeline.shared.image(for: art, maxPixel: 360)
                    guard !Task.isCancelled, let self, self.artURL == art else { return }
                    self.imageView.image = image
                }
            }
        }
        if animation != animationURL {
            stop()
            loaded = nil
            animationURL = animation
        }
        updateRegistration()
    }

    func teardown() {
        imageTask?.cancel()
        animationURL = nil
        updateRegistration()
        stop()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updateRegistration()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        ChatProbe.count("gift layout")
    }

    private func updateRegistration() {
        let wanted = window != nil && animationURL != nil
        guard wanted != registered else { return }
        registered = wanted
        if wanted {
            GiftPlayback.shared.register(self)
        } else {
            GiftPlayback.shared.unregister(self)
        }
    }

    /// Updates the on-screen frame; true while any part of it is visible
    /// and no sheet or dialog covers it.
    func observe(_ now: CFTimeInterval) -> Bool {
        guard let window, !isHidden, bounds.width > 1 else {
            screenFrame = .null
            return false
        }
        let frame = convert(bounds, to: nil)
        if lastFrame.isNull || abs(frame.minX - lastFrame.minX) > 0.5 || abs(frame.minY - lastFrame.minY) > 0.5 {
            stillSince = now
        }
        lastFrame = frame
        screenFrame = frame
        return frame.intersects(window.bounds) && !isCovered
    }

    /// A controller above this view presents something (a sheet over the
    /// grid). A presented controller's next responder is its presenter, so
    /// the sheet's own content passes its presenter without being covered.
    private var isCovered: Bool {
        var responder: UIResponder? = self
        var below: UIViewController?
        while let current = responder {
            if let controller = current as? UIViewController {
                if let presented = controller.presentedViewController, presented !== below, !presented.isBeingDismissed {
                    return true
                }
                below = controller
            }
            responder = current.next
        }
        return false
    }

    func play() {
        guard !wantsPlay, let url = animationURL else { return }
        wantsPlay = true
        if let loaded {
            mount(loaded)
            return
        }
        animationTask = Task { [weak self] in
            let animation = await GiftAnimations.shared.animation(for: url)
            guard let self, self.wantsPlay, self.animationURL == url, let animation else { return }
            self.loaded = animation
            self.mount(animation)
        }
    }

    func stop() {
        wantsPlay = false
        animationTask?.cancel()
        animationTask = nil
        stepper?.invalidate()
        stepper = nil
        guard let player = lottieView else { return }
        ChatProbe.count("gift unmount")
        lottieView = nil
        player.stop()
        player.removeFromSuperview()
        imageView.alpha = 1
    }

    private func mount(_ animation: LottieAnimation) {
        guard wantsPlay, lottieView == nil else { return }
        ChatProbe.count("gift mount")
        let player = LottieAnimationView(animation: animation)
        player.contentMode = .scaleAspectFit
        player.loopMode = .loop
        player.backgroundBehavior = .pauseAndRestore
        player.frame = bounds
        player.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        player.alpha = 0
        addSubview(player)
        lottieView = player
        if player.currentRenderingEngine == .mainThread {
            // Merge paths and the like keep Lottie on the main thread, where
            // 60 frames a second of a detailed gift stall scrolling: step it
            // at 20. Core Animation plays the others off the main thread.
            steppedSince = CACurrentMediaTime()
            let link = CADisplayLink(target: self, selector: #selector(step(_:)))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 24, preferred: 20)
            link.add(to: .main, forMode: .common)
            stepper = link
        } else {
            player.play()
        }
        #if DEBUG
        Logger(subsystem: "com.noctgram.ios", category: "gifts").notice(
            "mounted \(self.animationURL?.lastPathComponent ?? "?", privacy: .public) on \(player.currentRenderingEngine == .mainThread ? "the main thread, 20 fps" : "Core Animation", privacy: .public)")
        #endif
        UIView.animate(withDuration: 0.2) {
            player.alpha = 1
            self.imageView.alpha = 0
        }
    }
}

extension GiftPlayerView {
    @objc fileprivate func step(_ link: CADisplayLink) {
        guard let player = lottieView, let duration = player.animation?.duration, duration > 0 else { return }
        let elapsed = (link.timestamp - steppedSince).truncatingRemainder(dividingBy: duration)
        player.currentProgress = CGFloat(elapsed / duration)
    }
}

struct GiftPlayer: UIViewRepresentable {
    let art: URL?
    let animation: URL?
    var featured = false

    func makeUIView(context: Context) -> GiftPlayerView {
        GiftPlayerView(frame: .zero)
    }

    func updateUIView(_ view: GiftPlayerView, context: Context) {
        ChatProbe.count("gift update")
        view.configure(art: art, animation: animation, featured: featured)
    }

    static func dismantleUIView(_ view: GiftPlayerView, coordinator: ()) {
        view.teardown()
    }
}

/// gzip → raw DEFLATE for NSData's zlib decoder (RFC 1952 header and trailer).
enum Gzip {
    static func inflate(_ data: Data) -> Data? {
        let bytes = [UInt8](data)
        guard bytes.count > 18, bytes[0] == 0x1F, bytes[1] == 0x8B, bytes[2] == 8 else { return nil }
        let flags = bytes[3]
        var index = 10
        if flags & 0x04 != 0 {
            guard index + 2 <= bytes.count else { return nil }
            index += 2 + Int(bytes[index]) + Int(bytes[index + 1]) << 8
        }
        if flags & 0x08 != 0 {
            while index < bytes.count, bytes[index] != 0 { index += 1 }
            index += 1
        }
        if flags & 0x10 != 0 {
            while index < bytes.count, bytes[index] != 0 { index += 1 }
            index += 1
        }
        if flags & 0x02 != 0 { index += 2 }
        guard index < bytes.count - 8 else { return nil }
        let deflate = Data(bytes[index..<(bytes.count - 8)])
        return try? (deflate as NSData).decompressed(using: .zlib) as Data
    }
}
