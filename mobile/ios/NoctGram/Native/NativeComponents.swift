import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers
import AVKit
import ImageIO

enum NGTheme {
    static let background = Color(red: 0.035, green: 0.031, blue: 0.043)
    static let surface = Color(red: 0.09, green: 0.082, blue: 0.106)
    static let accent = Color(red: 0.79, green: 0.70, blue: 0.93)
    static let muted = Color(UIColor.secondaryLabel)
}

private struct NGGlassModifier: ViewModifier {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    let radius: CGFloat
    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(NGTheme.surface, in: RoundedRectangle(cornerRadius: radius))
        } else {
            #if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: radius))
            } else {
                content.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius))
            }
            #else
            content.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: radius))
            #endif
        }
    }
}

extension View {
    func ngGlass(radius: CGFloat = 24) -> some View { modifier(NGGlassModifier(radius: radius)) }

    @ViewBuilder func ngClearScrollBackground() -> some View {
        if #available(iOS 16.0, *) { scrollContentBackground(.hidden) }
        else { self }
    }
}

struct NGPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @ViewBuilder
    func makeBody(configuration: Configuration) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *), !reduceTransparency {
            label(configuration)
                .glassEffect(.regular.tint(NGTheme.accent).interactive(), in: Capsule())
                .opacity(enabled ? 1 : 0.45)
        } else {
            label(configuration).background(NGTheme.accent, in: Capsule()).opacity(enabled ? 1 : 0.45)
        }
        #else
        label(configuration).background(NGTheme.accent, in: Capsule()).opacity(enabled ? 1 : 0.45)
        #endif
    }
    private func label(_ configuration: Configuration) -> some View {
        configuration.label.font(.headline).padding(.horizontal, 20).frame(minHeight: 52)
            // Include padding and transparent spacers in the button's touch target.
            .contentShape(Rectangle())
            .foregroundColor(.black).opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct NGEmptyState: View {
    let title: String
    let message: String
    var systemImage: String = "moon.zzz"
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage).font(.largeTitle).foregroundColor(NGTheme.accent).accessibilityHidden(true)
            Text(title).font(.title3.bold())
            Text(message).font(.subheadline).foregroundColor(NGTheme.muted)
        }.multilineTextAlignment(.center).padding(24).frame(maxWidth: .infinity)
    }
}

enum NGImageCache {
    private(set) static var epoch = UUID()
    static func clear() {
        epoch = UUID()
        shared.removeAllObjects()
    }
    static let shared: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.totalCostLimit = 24 * 1024 * 1024
        cache.countLimit = 80
        return cache
    }()
}

struct NGRemoteImage: View {
    let path: String
    var contentMode: ContentMode = .fill
    var onAspectRatio: ((CGFloat) -> Void)? = nil
    @State private var image: UIImage?
    @State private var failed = false
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if let image {
                    Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                } else if failed { Image(systemName: "photo").foregroundColor(NGTheme.muted) }
                else { NGTheme.surface; ProgressView().tint(NGTheme.muted) }
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .clipped()
        }
        .task(id: path) {
            let cacheEpoch = NGImageCache.epoch
            image = nil
            failed = false
            guard let url = URL(string: path, relativeTo: URL(string: "https://noctgram.com")!)?.absoluteURL,
                  url.scheme == "https", url.user == nil, url.password == nil else { failed = true; return }
            if let cached = NGImageCache.shared.object(forKey: url.absoluteString as NSString) {
                image = cached
                onAspectRatio?(cached.size.width / max(1, cached.size.height))
                return
            }
            do {
                let data: Data
                if url.host == "noctgram.com", url.port == nil || url.port == 443, url.path.hasPrefix("/api/") {
                    data = try await NoctAPI.shared.download(url.absoluteString, maxBytes: 25 * 1024 * 1024)
                } else {
                    // External avatars have no access to the authenticated API cookie jar.
                    data = try await NativePublicMedia.download(url)
                }
                try Task.checkCancellation()
                guard cacheEpoch == NGImageCache.epoch else { return }
                guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                        kCGImageSourceCreateThumbnailFromImageAlways: true,
                        kCGImageSourceThumbnailMaxPixelSize: 1400,
                        kCGImageSourceCreateThumbnailWithTransform: true
                      ] as CFDictionary) else { failed = true; return }
                let value = UIImage(cgImage: decoded)
                NGImageCache.shared.setObject(value, forKey: url.absoluteString as NSString,
                                             cost: decoded.bytesPerRow * decoded.height)
                image = value
                onAspectRatio?(value.size.width / max(1, value.size.height))
            } catch is CancellationError { } catch { if !Task.isCancelled { failed = true } }
        }
    }
}

struct NGAvatar: View {
    let url: String
    let name: String
    var size: CGFloat = 44
    var body: some View {
        ZStack {
            Circle().fill(NGTheme.accent.opacity(0.16))
            if url.isEmpty {
                Text(String(name.prefix(1)).uppercased()).font(.system(size: size * 0.4, weight: .semibold)).foregroundColor(NGTheme.accent)
            } else { NGRemoteImage(path: url) }
        }.frame(width: size, height: size).clipShape(Circle()).accessibilityHidden(true)
    }
}

enum NGTemporaryMedia {
    static let directory = FileManager.default.temporaryDirectory.appendingPathComponent("NoctNativeMedia", isDirectory: true)
    static func save(_ data: Data, extension suffix: String) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let clean = suffix.filter { $0.isLetter || $0.isNumber }
        let path = directory.appendingPathComponent(UUID().uuidString).appendingPathExtension(String(clean.prefix(8)))
        try data.write(to: path, options: [.atomic, .completeFileProtection])
        return path
    }
    static func removeAll() { try? FileManager.default.removeItem(at: directory) }
}

@available(iOS 16.0, *)
private struct NGMediaPreviewLayout: Layout {
    let aspectRatio: CGFloat
    let maximumHeight: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let proposedWidth = proposal.width ?? 320
        let width = proposedWidth.isFinite ? max(1, proposedWidth) : 320
        return CGSize(width: width, height: min(maximumHeight, width / aspectRatio))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for subview in subviews {
            subview.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
        }
    }
}

struct NGMediaView: View {
    let record: NGRecord
    var isPrivate = false
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var showing = false
    @State private var previewAspectRatio: CGFloat = 4 / 3
    private var path: String { record.string("url", default: "/api/media/" + record.id) }
    private var type: String { record.string("type") }
    private var isImage: Bool { type.hasPrefix("image/") || record.string("kind") == "image" }
    var body: some View {
        Button { showing = true } label: {
            if isImage {
                Group {
                    if #available(iOS 16.0, *) {
                        NGMediaPreviewLayout(aspectRatio: previewAspectRatio,
                                             maximumHeight: verticalSizeClass == .compact ? 220 : 480) {
                            previewImage
                        }
                    } else {
                        previewImage.frame(maxWidth: .infinity).frame(height: 230)
                    }
                }
                    .background(NGTheme.surface).clipShape(RoundedRectangle(cornerRadius: 18))
            } else {
                HStack(spacing: 14) {
                    Image(systemName: type.hasPrefix("video/") ? "play.circle.fill" : "doc.fill").font(.title)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(record.string("name", default: "Вложение")).lineLimit(2)
                        if record.int("size") > 0 { Text(ByteCountFormatter.string(fromByteCount: Int64(record.int("size")), countStyle: .file)).font(.caption).foregroundColor(NGTheme.muted) }
                    }
                    Spacer()
                    Image(systemName: "arrow.down.circle")
                }.padding(16).background(NGTheme.surface, in: RoundedRectangle(cornerRadius: 18))
            }
        }
        .buttonStyle(.plain).accessibilityLabel(isImage ? "Открыть фотографию" : "Открыть " + record.string("name", default: "вложение"))
        .accessibilityIdentifier("media." + record.id)
        .onChange(of: path) { _ in previewAspectRatio = 4 / 3 }
        .fullScreenCover(isPresented: $showing) { NGMediaDetail(record: record, path: path) }
    }

    private var previewImage: some View {
        NGRemoteImage(path: path, contentMode: .fill) { ratio in
            previewAspectRatio = min(3, max(0.75, ratio))
        }
    }
}

private struct NGMediaDetail: View {
    let record: NGRecord
    let path: String
    @Environment(\.dismiss) private var dismiss
    @State private var localURL: URL?
    @State private var player: AVPlayer?
    @State private var error: String?
    @State private var share = false
    var body: some View {
        NavigationView {
            ZStack {
                Color.black.ignoresSafeArea()
                if let player { VideoPlayer(player: player) }
                else if let url = localURL, let picture = UIImage(contentsOfFile: url.path) {
                    Image(uiImage: picture).resizable().scaledToFit()
                } else if localURL != nil {
                    VStack(spacing: 20) {
                        Image(systemName: "doc.fill").font(.largeTitle)
                        Text(record.string("name", default: "Файл"))
                        Button("Открыть или сохранить") { share = true }.buttonStyle(NGPrimaryButtonStyle())
                    }.padding(24)
                } else if let error {
                    NGEmptyState(title: "Файл недоступен", message: error, systemImage: "exclamationmark.circle")
                } else { ProgressView("Загрузка…").tint(NGTheme.accent) }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) { Button("Готово") { dismiss() } }
                ToolbarItem(placement: .navigationBarTrailing) { Button { share = true } label: { Image(systemName: "square.and.arrow.up").frame(minWidth: 44, minHeight: 44) }.disabled(localURL == nil).accessibilityLabel("Поделиться") }
            }
        }.navigationViewStyle(.stack)
        .task {
            do {
                let data = try await NoctAPI.shared.download(path)
                try Task.checkCancellation()
                let suffix = (record.string("name") as NSString).pathExtension
                let file = try NGTemporaryMedia.save(data, extension: suffix.isEmpty ? "data" : suffix)
                localURL = file
                if record.string("type").hasPrefix("video/") || record.string("type").hasPrefix("audio/") { player = AVPlayer(url: file) }
            } catch is CancellationError { } catch { self.error = error.localizedDescription }
        }
        .onDisappear { player?.pause(); if let localURL { try? FileManager.default.removeItem(at: localURL) } }
        .sheet(isPresented: $share) { if let localURL { NGShareSheet(items: [localURL]) } }
    }
}

struct NGShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController { UIActivityViewController(activityItems: items, applicationActivities: nil) }
    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

struct NGPhotoPicker: UIViewControllerRepresentable {
    var onPick: (Data, String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        configuration.filter = .any(of: [.images, .videos])
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}
    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let parent: NGPhotoPicker
        init(_ parent: NGPhotoPicker) { self.parent = parent }
        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            parent.dismiss()
            guard let provider = results.first?.itemProvider else { return }
            if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
                provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                    guard let url,
                          let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                          size <= 25 * 1024 * 1024, let data = try? Data(contentsOf: url) else {
                        DispatchQueue.main.async { NotificationCenter.default.post(name: Notification.Name("noctPickerError"), object: "Видео должно быть меньше 25 МБ.") }
                        return
                    }
                    let suffix = url.pathExtension.lowercased()
                    DispatchQueue.main.async { self.parent.onPick(data, "video." + suffix, suffix == "mov" ? "video/quicktime" : "video/mp4") }
                }
            } else {
                provider.loadObject(ofClass: UIImage.self) { item, _ in
                    guard let image = item as? UIImage else { return }
                    let ratio = min(1, 2048 / max(image.size.width, image.size.height))
                    let size = CGSize(width: image.size.width * ratio, height: image.size.height * ratio)
                    let format = UIGraphicsImageRendererFormat()
                    format.scale = 1
                    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                    guard let data = rendered.jpegData(compressionQuality: 0.88) else { return }
                    DispatchQueue.main.async { self.parent.onPick(data, "photo.jpg", "image/jpeg") }
                }
            }
        }
    }
}

struct NGDocumentPicker: UIViewControllerRepresentable {
    var onPick: (Data, String, String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIViewController(context: Context) -> UIDocumentPickerViewController {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIDocumentPickerViewController, context: Context) {}
    final class Coordinator: NSObject, UIDocumentPickerDelegate {
        let parent: NGDocumentPicker
        init(_ parent: NGDocumentPicker) { self.parent = parent }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
            guard let url = urls.first else { return }
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                  size <= 25 * 1024 * 1024, let data = try? Data(contentsOf: url) else {
                NotificationCenter.default.post(name: Notification.Name("noctPickerError"), object: "Файл должен быть меньше 25 МБ.")
                return
            }
            parent.onPick(data, url.lastPathComponent, UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")
        }
    }
}
