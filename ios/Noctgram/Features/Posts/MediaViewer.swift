import AVFoundation
import AVKit
import SwiftUI
import UIKit

/// AVFoundation loads media outside URLSession, so the session cookie is passed explicitly.
enum AuthorizedAsset {
    static func asset(_ url: URL) -> AVURLAsset {
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        return AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
    }
}

final class VideoThumbnails: @unchecked Sendable {
    static let shared = VideoThumbnails()
    private let cache = NSCache<NSURL, UIImage>()

    func thumbnail(for url: URL) async -> UIImage? {
        if let image = cache.object(forKey: url as NSURL) { return image }
        let generator = AVAssetImageGenerator(asset: AuthorizedAsset.asset(url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 900, height: 900)
        guard let result = try? await generator.image(at: CMTime(seconds: 0.1, preferredTimescale: 600)) else { return nil }
        let image = UIImage(cgImage: result.image)
        cache.setObject(image, forKey: url as NSURL)
        return image
    }
}

struct VideoThumbnail: View {
    let url: URL?
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Noct.coverFill
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            }
        }
        .task(id: url) {
            guard let url else { return }
            let result = await VideoThumbnails.shared.thumbnail(for: url)
            withAnimation(.easeOut(duration: 0.2)) { image = result }
        }
    }
}

/// Full-screen photos (pinch and double-tap zoom) and videos, swiped as pages.
struct MediaViewer: View {
    @EnvironmentObject private var session: AppSession
    @Environment(\.dismiss) private var dismiss
    let items: [MediaItem]
    @State private var index: Int

    init(items: [MediaItem], index: Int) {
        self.items = items
        _index = State(initialValue: index)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(items.enumerated()), id: \.offset) { position, item in
                    Group {
                        if item.isVideo {
                            VideoPage(url: session.api.mediaURL(item.path), active: position == index)
                        } else {
                            PhotoPage(url: session.api.mediaURL(item.path))
                        }
                    }
                    .tag(position)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: items.count > 1 ? .automatic : .never))
            .ignoresSafeArea()

            HStack {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(CircleButtonStyle(size: 38))
                Spacer()
                if items.count > 1 {
                    Text("\(index + 1) из \(items.count)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(Noct.text75)
                }
                Spacer()
                if items.indices.contains(index), items[index].isImage {
                    Button {
                        Task { await save(items[index]) }
                    } label: {
                        Image(systemName: "square.and.arrow.down")
                    }
                    .buttonStyle(CircleButtonStyle(size: 38))
                } else {
                    Color.clear.frame(width: 38, height: 38)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .statusBarHidden()
    }

    private func save(_ item: MediaItem) async {
        guard let url = session.api.mediaURL(item.path),
              let data = await ImagePipeline.shared.data(for: url),
              let image = UIImage(data: data) else {
            session.show("Не удалось загрузить фото")
            return
        }
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
        session.show("Фото сохранено")
    }
}

private struct PhotoPage: View {
    let url: URL?
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                ZoomableImage(image: image)
            } else {
                ProgressView().tint(.white.opacity(0.6))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: url) {
            guard let url else { return }
            image = await ImagePipeline.shared.image(for: url, maxPixel: 2600)
        }
    }
}

private struct VideoPage: View {
    let url: URL?
    let active: Bool
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            if let player {
                VideoPlayer(player: player)
            } else {
                ProgressView().tint(.white.opacity(0.6))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            guard player == nil, let url else { return }
            let item = AVPlayerItem(asset: AuthorizedAsset.asset(url))
            player = AVPlayer(playerItem: item)
            if active { player?.play() }
        }
        .onChange(of: active) { isActive in
            if isActive { player?.play() } else { player?.pause() }
        }
        .onDisappear { player?.pause() }
    }
}

/// UIScrollView-based zoom: pinch, pan and double tap.
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> UIScrollView {
        let scroll = UIScrollView()
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 4
        scroll.delegate = context.coordinator
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.backgroundColor = .clear
        scroll.contentInsetAdjustmentBehavior = .never
        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.frame = scroll.bounds
        imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        imageView.isUserInteractionEnabled = true
        scroll.addSubview(imageView)
        context.coordinator.imageView = imageView
        let doubleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(doubleTap)
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            imageView
        }

        @objc func doubleTapped(_ gesture: UITapGestureRecognizer) {
            guard let scroll = gesture.view as? UIScrollView else { return }
            if scroll.zoomScale > 1 {
                scroll.setZoomScale(1, animated: true)
            } else {
                let point = gesture.location(in: imageView)
                let size = CGSize(width: scroll.bounds.width / 2.5, height: scroll.bounds.height / 2.5)
                scroll.zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
            }
        }
    }
}
