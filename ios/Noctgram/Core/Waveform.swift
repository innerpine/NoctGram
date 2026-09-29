import Foundation

/// Voice message waveforms as lib/voice-waveform.ts keeps them: up to 100
/// samples of five bits (0–31), one base32 character each (0–9, then a–v).
enum Waveform {
    static let samples = 100
    private static let alphabet = Array("0123456789abcdefghijklmnopqrstuv")

    static func encode(_ values: [Int]) -> String {
        String(values.prefix(samples).map { alphabet[max(0, min(31, $0))] })
    }

    static func decode(_ text: String) -> [Int] {
        text.prefix(samples).compactMap { alphabet.firstIndex(of: $0) }
    }

    /// Peaks are 16-bit amplitudes (0–32767) collected while recording. Like
    /// Telegram clients, loud outliers are capped at 1.8× the mean first.
    static func fromPeaks(_ peaks: [Double], count: Int = samples) -> [Int] {
        guard !peaks.isEmpty, count > 0 else { return [] }
        let values: [Double] = (0..<count).map { index in
            let start = index * peaks.count / count
            let end = max(start + 1, (index + 1) * peaks.count / count)
            return peaks[start..<min(end, peaks.count)].map(abs).max() ?? 0
        }
        let peak = max(values.reduce(0, +) * 1.8 / Double(count), 2500)
        return values.map { Int(min(31, (min($0, peak) * 31 / peak).rounded())) }
    }

    /// Bars for a player of a given width: the loudest sample in each span.
    static func resample(_ values: [Int], bars: Int) -> [Int] {
        guard bars > 0 else { return [] }
        guard !values.isEmpty else { return Array(repeating: 0, count: bars) }
        return (0..<bars).map { index in
            let start = index * values.count / bars
            let end = max(start + 1, (index + 1) * values.count / bars)
            return values[start..<min(end, values.count)].max() ?? 0
        }
    }

    /// Longer recordings get a wider player, as in Telegram.
    static func barCount(duration: Double) -> Int {
        max(24, min(56, Int((10 + duration * 2).rounded())))
    }

    /// «0:07», or «0:07,4» with tenths while recording.
    static func clock(_ seconds: Double, tenths: Bool = false) -> String {
        let total = max(0, seconds)
        let base = String(format: "%d:%02d", Int(total) / 60, Int(total) % 60)
        return tenths ? base + "," + String(Int(total * 10) % 10) : base
    }
}
