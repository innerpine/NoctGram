import AVFoundation
import AVKit
import SwiftUI
#if DEBUG
import os
#endif
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
        // The frame is an overlay, as in RemoteImage: a wide video filling
        // its tile never widens the post around it.
        Noct.coverFill
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .transition(.opacity)
                }
            }
            .clipped()
            .task(id: url) {
                guard let url else { return }
                let result = await VideoThumbnails.shared.thumbnail(for: url)
                withAnimation(.easeOut(duration: 0.2)) { image = result }
            }
    }
}

/// Opens the media viewer over the whole app, tab bar included, as the top
/// layer of the root view (RootView) rather than a full-screen presentation
/// of the post, message or grid that asked for it: closing it can never be
/// left half done with the viewer frozen over the app, as happened when the
/// row that had presented it was redrawn in its lazy list.
@MainActor
final class MediaPresenter: ObservableObject {
    static let shared = MediaPresenter()
    @Published private(set) var state: MediaViewerState?

    /// Without a transition either way: a layer holding a video that was
    /// animated away could stay drawn over the app, dead to taps. The viewer
    /// fades itself in.
    func show(_ state: MediaViewerState) {
        ViewerLog.note("show \(state.id)")
        // The keyboard would stay over the viewer.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { self.state = state }
    }

    func close() {
        ViewerLog.note("presenter close, was \(state?.id ?? "nothing")")
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { state = nil }
    }
}

/// What the viewer did, in debug builds: the UI tests print it (ios-ipa.yml).
enum ViewerLog {
    #if DEBUG
    private static let log = Logger(subsystem: "com.noctgram.ios", category: "viewer")
    static func note(_ text: String) {
        log.notice("\(text, privacy: .public)")
    }
    #else
    @inline(__always) static func note(_ text: @autoclosure () -> String) {}
    #endif
}

/// Full-screen photos and videos, swiped as pages, dressed as in Telegram:
/// back, who sent it and when, and a menu on top; under a video its
/// controls, seek bar and actions. A tap shows or hides all of it, a playing
/// video hides it after three quiet seconds, a double tap on a video's left
/// or right half jumps 15 seconds.
struct MediaViewer: View {
    @EnvironmentObject private var session: AppSession
    let state: MediaViewerState
    @State private var index: Int
    @State private var chrome = true
    @State private var hiding: Task<Void, Never>?
    @State private var shared: SharedMedia?
    @State private var preparing = false
    @State private var notice: String?
    /// How far a swipe down (or up) has pulled the media away.
    @State private var pull: CGFloat = 0
    /// How far a sideways swipe has moved the pages.
    @State private var slide: CGFloat = 0
    /// Fades in once it is up.
    @State private var shown = false
    @StateObject private var videos = ViewerVideos()

    init(state: MediaViewerState) {
        self.state = state
        _index = State(initialValue: state.index)
    }

    /// The black behind the media fades as it is pulled away.
    private var backdrop: Double {
        let faded: CGFloat = min(0.75, abs(pull) / 420)
        return Double(1 - faded)
    }

    private var items: [MediaItem] { state.items }
    private var current: MediaItem? { items.indices.contains(index) ? items[index] : nil }

    var body: some View {
        ZStack {
            Color.black
                .opacity(backdrop)
                .ignoresSafeArea()
            // The pages side by side, moved by one pan for paging and
            // closing. A TabView pager is not used: on iOS 26 the buttons
            // drawn over it did not get their taps, the page under them did,
            // so «Назад» only hid the controls.
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        page(item)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                    }
                }
                .offset(x: slide - CGFloat(index) * geometry.size.width)
            }
            .ignoresSafeArea()
            .offset(y: pull)
            .modifier(ViewerDrag(pages: items.count > 1, changed: dragChanged, ended: dragEnded))

            if chrome && pull == 0 {
                controls
                    .transition(.opacity)
            }
            if let notice {
                VStack {
                    Text(notice)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 10)
                        .glassCapsule()
                        .padding(.top, 64)
                    Spacer(minLength: 0)
                }
                .transition(.opacity)
                .allowsHitTesting(false)
            }
        }
        .opacity(shown ? 1 : 0)
        .statusBarHidden(!chrome)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("media-viewer")
        .accessibilityAddTraits(.isModal)
        .onAppear {
            withAnimation(.easeOut(duration: 0.2)) { shown = true }
            if items.contains(where: \.isVideo) { PlaybackAudio.begin() }
            show(index)
        }
        .onDisappear {
            hiding?.cancel()
            videos.pauseAll()
            // Upright again only if full screen turned it (nothing to do
            // otherwise: UIKit is not asked anything while the viewer goes).
            ViewerOrientation.lock()
            PlaybackAudio.end()
        }
        .onChange(of: index) { position in show(position) }
        .sheet(item: $shared) { media in
            ActivityView(items: media.items)
                .presentationDetents([.medium, .large])
        }
    }

    @ViewBuilder private func page(_ item: MediaItem) -> some View {
        if item.isVideo, let playback = playback(item) {
            VideoPage(playback: playback, tap: toggleChrome, stopped: showChrome)
        } else {
            PhotoPage(url: session.api.mediaURL(item.path), tap: toggleChrome)
        }
    }

    private func playback(_ item: MediaItem) -> VideoPlayback? {
        guard let url = session.api.mediaURL(item.path) else { return nil }
        // Picture in picture takes the video away: the viewer closes.
        return videos.playback(for: item, url: url) { dismiss() }
    }

    // MARK: Chrome

    private var controls: some View {
        ZStack {
            if let item = current {
                if item.isVideo, let playback = playback(item) {
                    VideoControls(
                        playback: playback,
                        sharing: preparing,
                        deletable: state.delete != nil,
                        share: { share(item) },
                        delete: remove,
                        touched: scheduleHide
                    )
                } else {
                    photoActions(item)
                }
            }
            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
            }
        }
    }

    private var title: String {
        if !state.title.isEmpty { return state.title }
        return current?.isVideo == true ? "Видео" : "Фото"
    }

    private var subtitle: String {
        var parts: [String] = []
        if state.date > 0 { parts.append(Format.viewerDate(state.date)) }
        if items.count > 1 { parts.append("\(index + 1) из \(items.count)") }
        return parts.joined(separator: " · ")
    }

    private var topBar: some View {
        HStack(spacing: 10) {
            Button(action: close) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 19, weight: .semibold))
            }
            .buttonStyle(CircleButtonStyle(size: 46))
            .accessibilityLabel("Назад")
            .accessibilityIdentifier("viewer-back")
            Spacer(minLength: 0)
            VStack(spacing: 1) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 12.5))
                        .foregroundColor(Noct.text60)
                }
            }
            .lineLimit(1)
            .padding(.horizontal, 20)
            .frame(minHeight: 46)
            .glassCapsule()
            Spacer(minLength: 0)
            menu
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
    }

    private var menu: some View {
        Menu {
            if let item = current {
                Button {
                    save(item)
                } label: {
                    Label(item.isVideo ? "Сохранить видео" : "Сохранить фото", systemImage: "square.and.arrow.down")
                }
                Button {
                    share(item)
                } label: {
                    Label("Поделиться", systemImage: "square.and.arrow.up")
                }
                if state.delete != nil {
                    Button(role: .destructive, action: remove) {
                        Label("Удалить", systemImage: "trash")
                    }
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 46, height: 46)
                .glassCircle(interactive: true)
        }
        .accessibilityLabel("Ещё")
        .accessibilityIdentifier("viewer-menu")
    }

    /// Photos: share on the left, delete on the right, as in Telegram.
    private func photoActions(_ item: MediaItem) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            HStack {
                Button {
                    share(item)
                } label: {
                    if preparing {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "arrowshape.turn.up.right")
                            .font(.system(size: 19, weight: .semibold))
                    }
                }
                .buttonStyle(CircleButtonStyle(size: 50))
                .disabled(preparing)
                .accessibilityLabel("Поделиться")
                Spacer(minLength: 0)
                if state.delete != nil {
                    Button(action: remove) {
                        Image(systemName: "trash")
                            .font(.system(size: 18, weight: .semibold))
                    }
                    .buttonStyle(CircleButtonStyle(size: 50))
                    .accessibilityLabel("Удалить")
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    // MARK: Behaviour

    private func show(_ position: Int) {
        let item = items.indices.contains(position) ? items[position] : nil
        videos.pauseAll(except: item?.id)
        if let item, item.isVideo { playback(item)?.play() }
        showChrome()
    }

    private func showChrome() {
        withAnimation(Noct.quick) { chrome = true }
        scheduleHide()
    }

    private func toggleChrome() {
        withAnimation(Noct.quick) { chrome.toggle() }
        scheduleHide()
    }

    /// A playing video hides the chrome after three quiet seconds.
    private func scheduleHide() {
        hiding?.cancel()
        guard chrome else { return }
        #if DEBUG
        // Screenshots and UI tests of the viewer keep its chrome.
        let defaults = UserDefaults.standard
        if defaults.string(forKey: "noct.debugViewer") != nil || defaults.bool(forKey: "noct.viewerKeepsChrome") { return }
        #endif
        hiding = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled, let item = current, item.isVideo, playback(item)?.playing == true else { return }
            withAnimation(.easeOut(duration: 0.25)) { chrome = false }
        }
    }

    private func dismiss() {
        MediaPresenter.shared.close()
    }

    private func close() {
        ViewerLog.note("close, landscape \(ViewerOrientation.isLandscape)")
        // Stopped first: nothing plays or ticks while the viewer goes away.
        hiding?.cancel()
        videos.pauseAll()
        guard ViewerOrientation.isLandscape else {
            dismiss()
            return
        }
        // Upright first, then away: UIKit ignores a dismissal in the middle
        // of turning.
        ViewerOrientation.lock()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { dismiss() }
    }

    private func dragChanged(_ axis: ViewerAxis, _ distance: CGFloat) {
        switch axis {
        case .vertical:
            pull = distance
        case .horizontal:
            // The first and the last page only give a little.
            let beyond = (index == 0 && distance > 0) || (index == items.count - 1 && distance < 0)
            slide = beyond ? distance / 3 : distance
        }
    }

    /// Past a fifth of the screen, or a flick, turns the page.
    private func dragEnded(_ axis: ViewerAxis, _ distance: CGFloat, _ speed: CGFloat) {
        guard axis == .horizontal else {
            finishPull(distance, speed)
            return
        }
        var next = index
        if distance < -80 || speed < -600 { next = min(items.count - 1, index + 1) }
        if distance > 80 || speed > 600 { next = max(0, index - 1) }
        withAnimation(.spring(response: 0.35, dampingFraction: 0.9)) {
            index = next
            slide = 0
        }
    }

    /// A pull past 110 pt, or a flick, closes the viewer; less springs back.
    private func finishPull(_ distance: CGFloat, _ speed: CGFloat) {
        guard abs(distance) > 110 || abs(speed) > 900 else {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { pull = 0 }
            return
        }
        withAnimation(.easeOut(duration: 0.18)) { pull = distance < 0 ? -1200 : 1200 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) { close() }
    }

    /// The chat asks what to delete once the viewer is gone.
    private func remove() {
        guard let delete = state.delete else { return }
        close()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { delete() }
    }

    private func tell(_ text: String) {
        withAnimation(Noct.quick) { notice = text }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) {
            if notice == text { withAnimation(Noct.quick) { notice = nil } }
        }
    }

    private func share(_ item: MediaItem) {
        guard !preparing, let url = session.api.mediaURL(item.path) else { return }
        preparing = true
        Task {
            if item.isVideo {
                if let file = await MediaFiles.download(url, name: item.name) {
                    shared = SharedMedia(items: [file])
                } else {
                    tell("Не удалось загрузить видео")
                }
            } else if let data = await ImagePipeline.shared.data(for: url), let image = UIImage(data: data) {
                shared = SharedMedia(items: [image])
            } else {
                tell("Не удалось загрузить фото")
            }
            preparing = false
        }
    }

    private func save(_ item: MediaItem) {
        guard !preparing, let url = session.api.mediaURL(item.path) else { return }
        preparing = true
        Task {
            if item.isVideo {
                if let file = await MediaFiles.download(url, name: item.name),
                   UIVideoAtPathIsCompatibleWithSavedPhotosAlbum(file.path) {
                    UISaveVideoAtPathToSavedPhotosAlbum(file.path, nil, nil, nil)
                    tell("Видео сохранено")
                } else {
                    tell("Не удалось сохранить видео")
                }
            } else if let data = await ImagePipeline.shared.data(for: url), let image = UIImage(data: data) {
                UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
                tell("Фото сохранено")
            } else {
                tell("Не удалось загрузить фото")
            }
            preparing = false
        }
    }
}

/// Which way a drag of the viewer goes.
enum ViewerAxis {
    case horizontal, vertical
}

/// Dragging the media sideways turns the pages; down (or up) closes the
/// viewer, as in Telegram. From iOS 18 one UIKit pan decides which by the
/// first move; a zoomed photo keeps its own panning.
private struct ViewerDrag: ViewModifier {
    let pages: Bool
    let changed: (ViewerAxis, CGFloat) -> Void
    /// The way, the distance dragged and the speed at the end.
    let ended: (ViewerAxis, CGFloat, CGFloat) -> Void
    @State private var axis: ViewerAxis?

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(ViewerPan(pages: pages, changed: changed, ended: ended))
        } else {
            content.gesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        let dx = value.translation.width, dy = value.translation.height
                        if axis == nil {
                            axis = abs(dy) > abs(dx) * 1.2 || !pages ? .vertical : .horizontal
                        }
                        guard let axis else { return }
                        changed(axis, axis == .horizontal ? dx : dy)
                    }
                    .onEnded { value in
                        let way = axis ?? .vertical
                        axis = nil
                        let distance = way == .horizontal ? value.translation.width : value.translation.height
                        let predicted = way == .horizontal ? value.predictedEndTranslation.width : value.predictedEndTranslation.height
                        ended(way, distance, (predicted - distance) * 4)
                    }
            )
        }
    }
}

@available(iOS 18.0, *)
private struct ViewerPan: UIGestureRecognizerRepresentable {
    let pages: Bool
    let changed: (ViewerAxis, CGFloat) -> Void
    let ended: (ViewerAxis, CGFloat, CGFloat) -> Void

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }

    func updateUIGestureRecognizer(_ pan: UIPanGestureRecognizer, context: Context) {
        context.coordinator.pages = pages
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        let axis = context.coordinator.axis
        let move = pan.translation(in: pan.view), speed = pan.velocity(in: pan.view)
        let distance = axis == .horizontal ? move.x : move.y
        switch pan.state {
        case .began, .changed: changed(axis, distance)
        case .ended: ended(axis, distance, axis == .horizontal ? speed.x : speed.y)
        case .cancelled, .failed: ended(axis, 0, 0)
        default: break
        }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var pages = false
        var axis: ViewerAxis = .vertical

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer, let view = pan.view else { return false }
            var way = pan.translation(in: view)
            if way == .zero { way = pan.velocity(in: view) }
            // A zoomed photo pans itself.
            var hit = view.hitTest(pan.location(in: view), with: nil)
            while let current = hit {
                if let scroll = current as? UIScrollView, scroll.zoomScale > 1.01 { return false }
                hit = current.superview
            }
            if abs(way.y) > abs(way.x) * 1.2 {
                axis = .vertical
                return true
            }
            guard pages, abs(way.x) > abs(way.y) else { return false }
            axis = .horizontal
            return true
        }

        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            other.view is UIScrollView
        }
    }
}

/// The viewer's videos, made as their pages first show.
@MainActor
final class ViewerVideos: ObservableObject {
    private var playbacks: [String: VideoPlayback] = [:]

    func playback(for item: MediaItem, url: URL, onPictureInPicture: @escaping () -> Void) -> VideoPlayback {
        if let playback = playbacks[item.id] { return playback }
        let playback = VideoPlayback(url: url, bytes: item.size > 0 ? item.size : nil)
        playback.onPictureInPicture = onPictureInPicture
        playbacks[item.id] = playback
        return playback
    }

    /// A video in picture in picture keeps playing.
    func pauseAll(except id: String? = nil) {
        for (key, playback) in playbacks where key != id && !playback.inPictureInPicture {
            playback.pause()
        }
    }
}

private struct PhotoPage: View {
    let url: URL?
    let tap: () -> Void
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                ZoomableImage(image: image, tap: tap)
            } else {
                ProgressView()
                    .tint(.white.opacity(0.6))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: tap)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: url) {
            guard let url else { return }
            image = await ImagePipeline.shared.image(for: url, maxPixel: 2600)
        }
    }
}

/// A video's picture. A tap shows or hides the chrome; a double tap on the
/// left or right half jumps 15 seconds back or ahead, with a hint there.
private struct VideoPage: View {
    let playback: VideoPlayback
    let tap: () -> Void
    /// The video paused or ended: the chrome comes back.
    let stopped: () -> Void
    @State private var hint: SeekHint?

    private struct SeekHint: Equatable {
        let back: Bool
        let id = UUID()
    }

    var body: some View {
        PlayerSurface(playback: playback)
            .overlay {
                HStack(spacing: 0) {
                    half(back: true)
                    half(back: false)
                }
            }
            .overlay(alignment: hint?.back == true ? .leading : .trailing) {
                if let hint {
                    Label("15 с", systemImage: hint.back ? "gobackward.15" : "goforward.15")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .glassCapsule()
                        .padding(.horizontal, 28)
                        .transition(.opacity)
                        .allowsHitTesting(false)
                }
            }
            .ignoresSafeArea()
            .background(PlaybackWatcher(playback: playback, stopped: stopped))
    }

    /// One half of the picture: a double tap jumps, a tap toggles the chrome.
    private func half(back: Bool) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                playback.skip(back ? -15 : 15)
                let shown = SeekHint(back: back)
                withAnimation(Noct.quick) { hint = shown }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                    if hint == shown { withAnimation(Noct.quick) { hint = nil } }
                }
            }
            .onTapGesture(perform: tap)
    }
}

/// Watches a video so that its page stays still while the clock ticks.
private struct PlaybackWatcher: View {
    @ObservedObject var playback: VideoPlayback
    let stopped: () -> Void

    var body: some View {
        Color.clear
            .onChange(of: playback.playing) { playing in
                if !playing { stopped() }
            }
    }
}

/// Telegram's controls of a video: back and ahead by 15 seconds around the
/// big play button; the size, the clock and the seek bar on glass; share,
/// picture in picture, speed, full screen and delete under them.
private struct VideoControls: View {
    @ObservedObject var playback: VideoPlayback
    let sharing: Bool
    let deletable: Bool
    let share: () -> Void
    let delete: () -> Void
    /// Any control used: the chrome stays a while longer.
    let touched: () -> Void

    static let speeds: [Float] = [0.5, 1, 1.25, 1.5, 2]

    var body: some View {
        ZStack {
            center
            VStack(spacing: 14) {
                Spacer(minLength: 0)
                timeline
                actions
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private var center: some View {
        HStack(spacing: 30) {
            Button {
                playback.skip(-15)
                touched()
            } label: {
                Image(systemName: "gobackward.15")
                    .font(.system(size: 26, weight: .medium))
            }
            .buttonStyle(CircleButtonStyle(size: 64))
            .accessibilityLabel("Назад на 15 секунд")
            Button {
                ViewerLog.note("play button")
                playback.toggle()
                touched()
            } label: {
                ZStack {
                    if playback.waiting {
                        ProgressView()
                            .tint(.white)
                            .scaleEffect(1.3)
                    } else {
                        Image(systemName: playback.playing ? "pause.fill" : "play.fill")
                            .font(.system(size: 36))
                    }
                }
            }
            .buttonStyle(CircleButtonStyle(size: 92))
            .accessibilityLabel(playback.playing ? "Пауза" : "Смотреть")
            Button {
                playback.skip(15)
                touched()
            } label: {
                Image(systemName: "goforward.15")
                    .font(.system(size: 26, weight: .medium))
            }
            .buttonStyle(CircleButtonStyle(size: 64))
            .accessibilityLabel("Вперёд на 15 секунд")
        }
    }

    private var timeline: some View {
        VStack(spacing: 4) {
            if let bytes = playback.bytes {
                Text(Format.fileSize(bytes))
            }
            HStack(spacing: 12) {
                Text(Format.playback(playback.time))
                    .monospacedDigit()
                VideoScrubber(
                    time: playback.time,
                    loaded: playback.loaded,
                    duration: playback.duration,
                    scrub: { fraction in
                        playback.scrub(to: fraction)
                        touched()
                    },
                    commit: { fraction in
                        playback.endScrub(at: fraction)
                        touched()
                    }
                )
                Text(Format.playback(playback.duration))
                    .monospacedDigit()
            }
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundColor(.white)
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .glassRect(28)
    }

    private var actions: some View {
        HStack {
            Button(action: share) {
                if sharing {
                    ProgressView().tint(.white)
                } else {
                    Image(systemName: "arrowshape.turn.up.right")
                        .font(.system(size: 19, weight: .semibold))
                }
            }
            .buttonStyle(CircleButtonStyle(size: 50))
            .disabled(sharing)
            .accessibilityLabel("Поделиться")
            Spacer(minLength: 0)
            HStack(spacing: 28) {
                if playback.canPictureInPicture {
                    Button {
                        playback.togglePictureInPicture()
                        touched()
                    } label: {
                        Image(systemName: "pip.enter")
                    }
                    .accessibilityLabel("Картинка в картинке")
                }
                Menu {
                    Picker("Скорость", selection: $playback.speed) {
                        ForEach(Self.speeds, id: \.self) { value in
                            Text(Self.label(value)).tag(value)
                        }
                    }
                } label: {
                    Image(systemName: "gearshape")
                }
                .accessibilityLabel("Скорость")
                Button {
                    ViewerOrientation.toggleLandscape()
                    touched()
                } label: {
                    Image(systemName: "viewfinder")
                }
                .accessibilityLabel("Во весь экран")
                .accessibilityIdentifier("viewer-fullscreen")
            }
            .buttonStyle(PressableStyle())
            .font(.system(size: 20, weight: .medium))
            .foregroundColor(.white)
            .padding(.horizontal, 24)
            .frame(height: 50)
            .glassCapsule()
            Spacer(minLength: 0)
            if deletable {
                Button(action: delete) {
                    Image(systemName: "trash")
                        .font(.system(size: 18, weight: .semibold))
                }
                .buttonStyle(CircleButtonStyle(size: 50))
                .accessibilityLabel("Удалить")
            } else {
                Color.clear.frame(width: 50, height: 50)
            }
        }
    }

    static func label(_ speed: Float) -> String {
        speed == 1 ? "Обычная" : String(format: "%g×", speed).replacingOccurrences(of: ".", with: ",")
    }
}

/// The seek bar: played part white, loaded part dimmer, a knob that grows
/// under the finger.
private struct VideoScrubber: View {
    let time: Double
    let loaded: Double
    let duration: Double
    let scrub: (Double) -> Void
    let commit: (Double) -> Void
    @State private var dragged: Double?

    var body: some View {
        GeometryReader { geometry in
            let width = max(1, geometry.size.width)
            let progress = dragged ?? (duration > 0 ? min(1, time / duration) : 0)
            let buffer = duration > 0 ? min(1, loaded / duration) : 0
            let knob: CGFloat = dragged == nil ? 12 : 18
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.22))
                Capsule().fill(Color.white.opacity(0.42)).frame(width: width * buffer)
                Capsule().fill(Color.white).frame(width: max(knob / 2, width * progress))
                Circle()
                    .fill(Color.white)
                    .frame(width: knob, height: knob)
                    .offset(x: min(width - knob, max(0, width * progress - knob / 2)))
            }
            .frame(height: dragged == nil ? 6 : 8)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        let fraction = min(1, max(0, value.location.x / width))
                        dragged = fraction
                        scrub(fraction)
                    }
                    .onEnded { value in
                        let fraction = min(1, max(0, value.location.x / width))
                        commit(fraction)
                        dragged = nil
                    }
            )
            .animation(Noct.quick, value: dragged == nil)
        }
        .frame(height: 28)
        .accessibilityElement()
        .accessibilityLabel("Перемотка")
        .accessibilityValue(Format.playback(time))
    }
}

/// UIScrollView-based zoom: pinch, pan and double tap; a single tap goes
/// to the viewer.
struct ZoomableImage: UIViewRepresentable {
    let image: UIImage
    var tap: (() -> Void)?

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
        let singleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        singleTap.require(toFail: doubleTap)
        scroll.addGestureRecognizer(singleTap)
        context.coordinator.tap = tap
        return scroll
    }

    func updateUIView(_ scroll: UIScrollView, context: Context) {
        context.coordinator.imageView?.image = image
        context.coordinator.tap = tap
    }

    final class Coordinator: NSObject, UIScrollViewDelegate {
        weak var imageView: UIImageView?
        var tap: (() -> Void)?

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            imageView
        }

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            tap?()
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
