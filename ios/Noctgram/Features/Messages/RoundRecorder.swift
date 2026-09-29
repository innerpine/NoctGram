import AVFoundation
import SwiftUI
import UIKit

/// Records a round video message as in Telegram: the front camera in a
/// circle, up to a minute, then a 384×384 MP4 (H.264 and AAC) as the web
/// makes it (lib/media-recorder.ts).
@MainActor
final class RoundRecorder: NSObject, ObservableObject {
    struct Recording {
        let url: URL
        let duration: Double
    }

    /// The server takes round videos of up to 61 seconds; a minute is recorded.
    static let limit: Double = 60
    static let side: CGFloat = 384

    let session = AVCaptureSession()
    @Published private(set) var running = false
    @Published private(set) var recording = false
    @Published private(set) var elapsed: Double = 0
    @Published private(set) var front = true
    /// The minute is up: the recording stopped by itself and waits to be sent.
    @Published private(set) var reachedLimit = false

    private let output = AVCaptureMovieFileOutput()
    private let queue = DispatchQueue(label: "com.noctgram.round")
    private var camera: AVCaptureDeviceInput?
    private var ticker: Timer?
    private var finished: CheckedContinuation<URL?, Never>?
    /// A file that ended before finish() asked for it (the limit).
    private var completed: URL?
    private var cancelled = false
    private var started = Date()

    static func permission() async -> Bool {
        let video: Bool
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: video = true
        case .notDetermined: video = await AVCaptureDevice.requestAccess(for: .video)
        default: video = false
        }
        guard video else { return false }
        return await VoiceRecorder.permission()
    }

    /// Turns the camera on for the preview.
    func prepare() throws {
        guard !running else { return }
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.playAndRecord, mode: .videoRecording, options: [.defaultToSpeaker, .allowBluetooth])
        try audio.setActive(true)
        session.beginConfiguration()
        session.sessionPreset = .high
        try attachCamera(position: .front)
        if let microphone = AVCaptureDevice.default(for: .audio),
           let input = try? AVCaptureDeviceInput(device: microphone), session.canAddInput(input) {
            session.addInput(input)
        }
        if session.canAddOutput(output) { session.addOutput(output) }
        output.maxRecordedDuration = CMTime(seconds: Self.limit, preferredTimescale: 600)
        orient()
        session.commitConfiguration()
        running = true
        let captured = session
        queue.async { captured.startRunning() }
    }

    private func attachCamera(position: AVCaptureDevice.Position) throws {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position) else {
            throw MediaEncoder.Failure(errorDescription: "Камера недоступна.")
        }
        let input = try AVCaptureDeviceInput(device: device)
        if let camera { session.removeInput(camera) }
        guard session.canAddInput(input) else { throw MediaEncoder.Failure(errorDescription: "Камера недоступна.") }
        session.addInput(input)
        camera = input
        front = position == .front
    }

    /// Upright, and mirrored for the front camera as the preview shows it.
    private func orient() {
        guard let connection = output.connection(with: .video) else { return }
        if #available(iOS 17.0, *) {
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
        } else if connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
        }
        if connection.isVideoMirroringSupported {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = front
        }
    }

    func flip() {
        guard running else { return }
        session.beginConfiguration()
        try? attachCamera(position: front ? .back : .front)
        orient()
        session.commitConfiguration()
    }

    func start() {
        guard running, !recording else { return }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("round-raw-\(UUID().uuidString).mov")
        output.startRecording(to: url, recordingDelegate: self)
        recording = true
        cancelled = false
        completed = nil
        reachedLimit = false
        started = Date()
        elapsed = 0
        let ticker = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(ticker, forMode: .common)
        self.ticker = ticker
    }

    private func tick() {
        elapsed = min(Self.limit, Date().timeIntervalSince(started))
    }

    /// Stops and makes the square file; nil when it is too short or failed.
    func finish() async -> Recording? {
        guard recording else { return nil }
        let duration = elapsed
        let raw: URL?
        if let completed {
            raw = completed
            self.completed = nil
        } else {
            raw = await withCheckedContinuation { continuation in
                finished = continuation
                output.stopRecording()
            }
        }
        stopTicker()
        shutdown()
        guard let raw, duration >= 1 else {
            if let raw { try? FileManager.default.removeItem(at: raw) }
            return nil
        }
        defer { try? FileManager.default.removeItem(at: raw) }
        guard let square = await Self.square(raw) else { return nil }
        return Recording(url: square, duration: duration)
    }

    func cancel() {
        cancelled = true
        if output.isRecording { output.stopRecording() }
        if let completed { try? FileManager.default.removeItem(at: completed) }
        completed = nil
        stopTicker()
        shutdown()
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
        recording = false
    }

    private func shutdown() {
        guard running else { return }
        running = false
        let captured = session
        queue.async { captured.stopRunning() }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        PlaybackAudio.idle()
    }

    fileprivate func deliver(_ url: URL?, file: URL) {
        if cancelled {
            try? FileManager.default.removeItem(at: file)
        } else if let continuation = finished {
            finished = nil
            continuation.resume(returning: url)
        } else if let url {
            // The minute is up before the finger let go.
            completed = url
            stopTicker()
            reachedLimit = true
        }
    }

    /// The middle square of the recording at 384×384 in MP4.
    static func square(_ raw: URL) async -> URL? {
        let asset = AVURLAsset(url: raw)
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let natural = try? await track.load(.naturalSize),
              let transform = try? await track.load(.preferredTransform),
              let duration = try? await asset.load(.duration) else { return nil }
        let turned = CGRect(origin: .zero, size: natural).applying(transform)
        let width = abs(turned.width), height = abs(turned.height)
        let crop = min(width, height)
        guard crop > 0 else { return nil }
        let scale = side / crop
        // Upright first, then the middle square to the origin, then scaled.
        var placement = transform.concatenating(CGAffineTransform(translationX: -turned.minX, y: -turned.minY))
        placement = placement.concatenating(CGAffineTransform(translationX: -(width - crop) / 2, y: -(height - crop) / 2))
        placement = placement.concatenating(CGAffineTransform(scaleX: scale, y: scale))
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
        layer.setTransform(placement, at: .zero)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: duration)
        instruction.layerInstructions = [layer]
        let composition = AVMutableVideoComposition()
        composition.renderSize = CGSize(width: side, height: side)
        composition.frameDuration = CMTime(value: 1, timescale: 30)
        composition.instructions = [instruction]
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetMediumQuality) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("round-\(UUID().uuidString).mp4")
        export.outputURL = url
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.videoComposition = composition
        await export.export()
        return export.status == .completed ? url : nil
    }
}

extension RoundRecorder: AVCaptureFileOutputRecordingDelegate {
    nonisolated func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo url: URL, from connections: [AVCaptureConnection], error: Error?) {
        // Reaching the minute ends the recording with an error that still
        // leaves a complete file.
        let complete = error == nil || ((error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool) == true
        Task { @MainActor in self.deliver(complete ? url : nil, file: url) }
    }
}

/// The live camera in the recording circle.
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.preview.session = session
        view.preview.videoGravity = .resizeAspectFill
        view.backgroundColor = .black
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}
}
