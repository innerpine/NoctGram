import Lottie
import SwiftUI
import UIKit

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
    private var missing: Set<URL> = []

    /// The animation next to a static `/assets/gifts/<name>.webp`.
    static func animationPath(forArt path: String) -> String? {
        guard path.hasPrefix("/assets/gifts/"), path.hasSuffix(".webp") else { return nil }
        let name = String(path.dropFirst("/assets/gifts/".count).dropLast(".webp".count))
        guard !name.isEmpty else { return nil }
        return "/assets/gifts/" + name + (name.hasPrefix("collectible-") ? ".tgs" : ".json")
    }

    func animation(for url: URL) async -> LottieAnimation? {
        if let hit = cache[url] { return hit }
        if missing.contains(url) { return nil }
        let task = running[url] ?? Task.detached(priority: .utility) { () -> Box? in
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
        guard let animation = box?.animation else {
            missing.insert(url)
            return nil
        }
        cache[url] = animation
        order.append(url)
        if order.count > 40 { cache[order.removeFirst()] = nil }
        return animation
    }
}

/// Plays a gift animation in a loop; pauses in the background.
struct GiftLottieView: UIViewRepresentable {
    let animation: LottieAnimation

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear
        let player = LottieAnimationView(animation: animation)
        player.contentMode = .scaleAspectFit
        player.loopMode = .loop
        player.backgroundBehavior = .pauseAndRestore
        player.frame = container.bounds
        player.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(player)
        player.play()
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        guard let player = container.subviews.first as? LottieAnimationView else { return }
        if player.animation !== animation {
            player.animation = animation
            player.play()
        } else if !player.isAnimationPlaying {
            player.play()
        }
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
