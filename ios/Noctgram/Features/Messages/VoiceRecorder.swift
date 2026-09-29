import AVFoundation
import Foundation

/// Records a voice message as AAC in MP4 (.m4a), the format the server takes
/// from every client (lib/chat-uploads.ts), and collects the peaks for its
/// waveform while it records.
@MainActor
final class VoiceRecorder: ObservableObject {
    struct Recording {
        let url: URL
        let duration: Double
        let waveform: [Int]
    }

    /// A voice message is at most an hour long (VOICE_MESSAGES.md).
    static let limit: Double = 60 * 60

    @Published private(set) var recording = false
    @Published private(set) var elapsed: Double = 0
    /// The loudness of the last moments, 0–1, for the live bars.
    @Published private(set) var level: Double = 0

    private var recorder: AVAudioRecorder?
    private var meter: Timer?
    private var peaks: [Double] = []
    private var started = Date()

    #if DEBUG
    /// UI tests (ios/Tests): the simulator of CI has no microphone, so
    /// `-noct.fakeRecorder 1` records a tone instead.
    static var fake: Bool { UserDefaults.standard.bool(forKey: "noct.fakeRecorder") }
    #else
    static let fake = false
    #endif

    /// Asks for the microphone once; false when the person declined it.
    static func permission() async -> Bool {
        if fake { return true }
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return true
            case .denied: return false
            default: return await AVAudioApplication.requestRecordPermission()
            }
        } else {
            let session = AVAudioSession.sharedInstance()
            switch session.recordPermission {
            case .granted: return true
            case .denied: return false
            default:
                return await withCheckedContinuation { continuation in
                    session.requestRecordPermission { continuation.resume(returning: $0) }
                }
            }
        }
    }

    func start() throws {
        guard !recording else { return }
        if !Self.fake {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 64000,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: Self.limit) else {
                throw MediaEncoder.Failure(errorDescription: "Не удалось включить микрофон.")
            }
            self.recorder = recorder
        }
        peaks = []
        started = Date()
        elapsed = 0
        level = 0
        recording = true
        let meter = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.sample() }
        }
        RunLoop.main.add(meter, forMode: .common)
        self.meter = meter
    }

    private func sample() {
        guard recording else { return }
        guard let recorder else {
            // The fake recording: a voice that rises and falls.
            elapsed = Date().timeIntervalSince(started)
            let wave = abs(sin(elapsed * 3.1)) * 0.7 + abs(sin(elapsed * 11.3)) * 0.3
            peaks.append(32767 * wave)
            level = wave
            return
        }
        recorder.updateMeters()
        // dBFS to a 16-bit amplitude, as the web's analyser peaks.
        let power = Double(recorder.peakPower(forChannel: 0))
        let amplitude = 32767 * pow(10, max(-60, power) / 20)
        peaks.append(amplitude)
        level = max(0, min(1, (Double(recorder.averagePower(forChannel: 0)) + 50) / 50))
        elapsed = recorder.isRecording ? recorder.currentTime : Date().timeIntervalSince(started)
        if !recorder.isRecording && elapsed >= Self.limit - 0.5 { meter?.invalidate() }
    }

    /// Stops and hands the file over; nil when it is too short to send.
    func finish() -> Recording? {
        guard recording else { return nil }
        guard let recorder else {
            let duration = Date().timeIntervalSince(started)
            let waveform = Waveform.fromPeaks(peaks)
            teardown()
            guard duration >= 0.5, let url = Self.tone(seconds: duration) else { return nil }
            return Recording(url: url, duration: duration, waveform: waveform)
        }
        let duration = recorder.isRecording ? recorder.currentTime : elapsed
        recorder.stop()
        teardown()
        guard duration >= 0.5 else {
            try? FileManager.default.removeItem(at: recorder.url)
            return nil
        }
        return Recording(url: recorder.url, duration: duration, waveform: Waveform.fromPeaks(peaks))
    }

    func cancel() {
        guard recording else { return }
        if let recorder {
            recorder.stop()
            recorder.deleteRecording()
        }
        teardown()
    }

    private func teardown() {
        meter?.invalidate()
        meter = nil
        recorder = nil
        recording = false
        level = 0
        if !Self.fake {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            PlaybackAudio.idle()
        }
    }

    /// A soft tone in AAC, for the fake recorder of the UI tests.
    private static func tone(seconds: Double) -> URL? {
        let rate = 44100.0
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64000]
        guard let file = try? AVAudioFile(forWriting: url, settings: settings),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(rate * seconds)),
              let samples = buffer.floatChannelData?[0] else { return nil }
        buffer.frameLength = buffer.frameCapacity
        for index in 0..<Int(buffer.frameLength) {
            let time = Double(index) / rate
            samples[index] = Float(sin(2 * .pi * 440 * time) * 0.2 * abs(sin(time * 3.1)))
        }
        guard (try? file.write(from: buffer)) != nil else { return nil }
        return url
    }
}
