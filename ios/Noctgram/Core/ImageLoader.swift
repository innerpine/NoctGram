import CryptoKit
import ImageIO
import SwiftUI
import UIKit

/// Loads private media with the session cookie, downsamples it with ImageIO
/// and keeps it in memory. Uploads and gift art never change, so they are
/// also cached on disk (the server marks media `no-store`).
final class ImagePipeline: @unchecked Sendable {
    static let shared = ImagePipeline()

    var session: URLSession = .shared
    private let memory = NSCache<NSString, UIImage>()
    private let lock = NSLock()
    private var running: [String: Task<UIImage?, Never>] = [:]
    private let directory: URL

    private init() {
        memory.totalCostLimit = 120 * 1024 * 1024
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        directory = caches.appendingPathComponent("noct-images", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func key(_ url: URL, _ size: CGFloat) -> String {
        url.absoluteString + "#" + String(Int(size))
    }

    func cached(_ url: URL, maxPixel: CGFloat) -> UIImage? {
        memory.object(forKey: key(url, maxPixel) as NSString)
    }

    func image(for url: URL, maxPixel: CGFloat) async -> UIImage? {
        let id = key(url, maxPixel)
        if let image = memory.object(forKey: id as NSString) { return image }
        let task = runningTask(id) {
            let session = self.session
            let file = self.diskFile(for: url)
            return Task.detached(priority: .userInitiated) {
                await ImagePipeline.fetch(url: url, maxPixel: maxPixel, session: session, file: file)
            }
        }
        let image = await task.value
        finish(id)
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            memory.setObject(image, forKey: id as NSString, cost: cost)
        }
        return image
    }

    /// One download per URL and size, however many views ask at once.
    private func runningTask(_ id: String, make: () -> Task<UIImage?, Never>) -> Task<UIImage?, Never> {
        lock.lock()
        defer { lock.unlock() }
        if let task = running[id] { return task }
        let task = make()
        running[id] = task
        return task
    }

    private func finish(_ id: String) {
        lock.lock()
        running[id] = nil
        lock.unlock()
    }

    /// Raw bytes for sharing or saving the original file.
    func data(for url: URL) async -> Data? {
        if let file = diskFile(for: url), let data = try? Data(contentsOf: file) { return data }
        guard let result = try? await session.data(from: url),
              (result.1 as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return result.0
    }

    func clear() {
        memory.removeAllObjects()
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    private func diskFile(for url: URL) -> URL? {
        let path = url.path
        guard path.hasPrefix("/api/media/") || path.hasPrefix("/assets/") else { return nil }
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(name)
    }

    private static func fetch(url: URL, maxPixel: CGFloat, session: URLSession, file: URL?) async -> UIImage? {
        if let file, let data = try? Data(contentsOf: file), let image = downsample(data, maxPixel: maxPixel) {
            return image
        }
        guard let result = try? await session.data(from: url),
              let response = result.1 as? HTTPURLResponse, response.statusCode == 200 else { return nil }
        let data = result.0
        guard let image = downsample(data, maxPixel: maxPixel) else { return nil }
        if let file { try? data.write(to: file, options: .atomic) }
        return image
    }

    static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(64, maxPixel),
        ] as CFDictionary
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else {
            return UIImage(data: data)
        }
        return UIImage(cgImage: image)
    }
}

/// An authenticated remote image. Fills its frame; the caller clips it.
struct RemoteImage: View {
    let url: URL?
    var maxPixel: CGFloat = 900
    var contentMode: ContentMode = .fill
    var placeholder: Color = Noct.coverFill

    @State private var image: UIImage?
    @State private var loadedURL: URL?

    init(url: URL?, maxPixel: CGFloat = 900, contentMode: ContentMode = .fill, placeholder: Color = Noct.coverFill) {
        self.url = url
        self.maxPixel = maxPixel
        self.contentMode = contentMode
        self.placeholder = placeholder
        let cached = url.flatMap { ImagePipeline.shared.cached($0, maxPixel: maxPixel) }
        _image = State(initialValue: cached)
        _loadedURL = State(initialValue: cached == nil ? nil : url)
    }

    var body: some View {
        ZStack {
            placeholder
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            }
        }
        .task(id: url) {
            guard let url else {
                image = nil
                return
            }
            if loadedURL == url, image != nil { return }
            let result = await ImagePipeline.shared.image(for: url, maxPixel: maxPixel)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.2)) {
                image = result
                loadedURL = url
            }
        }
    }
}
