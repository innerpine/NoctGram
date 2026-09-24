import SwiftUI
import UIKit
#if DEBUG
import os
#endif

/// Finds what keeps a chat busy (ios-ipa.yml, «Chat probes»). Launched with
/// «-noct.chatProbe <variant>», the chat scrolls itself up in steps while a
/// background thread counts what the chat redoes and checks that the main
/// thread still answers; it logs every step and quits. A variant switches
/// parts of the chat off («nogift+noswipe»); «lazy» switches nothing off.
/// «-noct.chatCounters 1» only logs the counts, for the UI tests, and
/// «-noct.chatParts» switches parts off without the probe. Release builds
/// carry no probe.
enum ChatProbe {
    /// Short message ids for the counts: «mock-4», «ad1fbe3a».
    static func short(_ id: String) -> String {
        String(id.split(separator: ":").last?.prefix(8) ?? "")
    }

    #if DEBUG
    private static let defaults = UserDefaults.standard
    static let variant = defaults.string(forKey: "noct.chatProbe")
    private static let parts = defaults.string(forKey: "noct.chatParts")
    static let counting = variant != nil || defaults.bool(forKey: "noct.chatCounters")
    /// «ax» when XCUITest launches the probe (accessibility on), «sim» otherwise.
    static let mode = defaults.string(forKey: "noct.chatProbeMode") ?? "sim"
    @MainActor private static var started = false

    static func has(_ part: String) -> Bool {
        [variant, parts].contains { list in
            list?.split(separator: "+").contains { $0 == part } == true
        }
    }

    static func count(_ name: @autoclosure () -> String) {
        guard counting else { return }
        ProbeWatch.shared.count(name())
    }

    /// Scrolls the open chat up by 150 pt at a time to the top, then back
    /// to the end, and quits.
    @MainActor
    static func run() async {
        guard counting, !started else { return }
        started = true
        ProbeWatch.shared.start()
        guard variant != nil else { return }
        ProbeWatch.shared.phase("open")
        try? await Task.sleep(nanoseconds: mode == "ax" ? 5_000_000_000 : 3_000_000_000)
        guard let scroll = chatScrollView() else {
            ProbeWatch.shared.phase("no scroll view")
            quit()
        }
        let top = -scroll.adjustedContentInset.top
        for step in 1...8 where scroll.contentOffset.y > top + 1 {
            let y = max(top, scroll.contentOffset.y - 150)
            ProbeWatch.shared.phase("up \(step) to \(Int(y)) of \(Int(scroll.contentSize.height))")
            scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: y), animated: true)
            try? await Task.sleep(nanoseconds: 1_200_000_000)
        }
        let end = max(top, scroll.contentSize.height + scroll.adjustedContentInset.bottom - scroll.bounds.height)
        ProbeWatch.shared.phase("down to \(Int(end))")
        scroll.setContentOffset(CGPoint(x: scroll.contentOffset.x, y: end), animated: true)
        try? await Task.sleep(nanoseconds: 2_000_000_000)
        ProbeWatch.shared.phase("done")
        quit()
    }

    static func quit() -> Never {
        Thread.sleep(forTimeInterval: 0.3)
        _exit(0)
    }

    /// The tallest vertical scroll view on screen: the chat's.
    @MainActor
    private static func chatScrollView() -> UIScrollView? {
        var best: UIScrollView?
        func visit(_ view: UIView) {
            if let scroll = view as? UIScrollView, !(view is UITextView), !view.isHidden,
               scroll.bounds.height > 300, scroll.contentSize.height > scroll.bounds.height,
               scroll.contentSize.height > best?.contentSize.height ?? 0 {
                best = scroll
            }
            view.subviews.forEach(visit)
        }
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .forEach(visit)
        return best
    }
    #else
    @inline(__always) static func has(_ part: String) -> Bool { false }
    @inline(__always) static func count(_ name: @autoclosure () -> String) {}
    #endif
}

#if DEBUG
/// Counts what the chat redoes and watches the main thread from a thread
/// of its own, so it reports even when the main thread never comes back.
final class ProbeWatch: @unchecked Sendable {
    static let shared = ProbeWatch()

    private struct State {
        var counts: [String: Int] = [:]
        var phase = "start"
        var since = CFAbsoluteTimeGetCurrent()
        var answered = CFAbsoluteTimeGetCurrent()
        var asking = false
        var running = false
    }

    private let state = OSAllocatedUnfairLock(initialState: State())
    private let log = Logger(subsystem: "com.noctgram.ios", category: "probe")

    func count(_ name: String) {
        state.withLock { $0.counts[name, default: 0] += 1 }
    }

    func start() {
        let first = state.withLock { state -> Bool in
            defer { state.running = true }
            return !state.running
        }
        guard first else { return }
        Thread.detachNewThread { [self] in watch() }
    }

    /// Logs what the finished phase counted and starts the next one.
    func phase(_ name: String) {
        let now = CFAbsoluteTimeGetCurrent()
        let finished = state.withLock { state -> (String, [String: Int], Double) in
            defer {
                state.phase = name
                state.counts = [:]
                state.since = now
            }
            return (state.phase, state.counts, now - state.since)
        }
        report(finished.0, finished.1, seconds: finished.2, stuck: nil)
    }

    private func report(_ phase: String, _ counts: [String: Int], seconds: Double, stuck: Double?) {
        let top = counts.sorted { $0.value > $1.value }.prefix(12).map { "\($0.key) \($0.value)" }.joined(separator: ", ")
        let status = stuck.map { String(format: "STUCK %.0f s", $0) } ?? "main ok"
        let head = "probe \(ChatProbe.mode) \(ChatProbe.variant ?? "tests") [\(phase)] " + String(format: "%.1f s", seconds)
        log.notice("\(head, privacy: .public), \(status, privacy: .public): \(top.isEmpty ? "nothing" : top, privacy: .public)")
    }

    /// Asks the main thread to answer every half second; a probe that gets
    /// no answer for 8 s reports and quits. Without a probe (UI tests) the
    /// counts go to the log every 4 s while there are any.
    private func watch() {
        var lastTick = CFAbsoluteTimeGetCurrent()
        while true {
            Thread.sleep(forTimeInterval: 0.5)
            let now = CFAbsoluteTimeGetCurrent()
            let (asking, silent) = state.withLock { ($0.asking, now - $0.answered) }
            if !asking {
                state.withLock { $0.asking = true }
                DispatchQueue.main.async { [self] in
                    state.withLock {
                        $0.asking = false
                        $0.answered = CFAbsoluteTimeGetCurrent()
                    }
                }
            }
            let stuck = asking && silent > 8 ? silent : nil
            if ChatProbe.variant != nil {
                guard let stuck else { continue }
                let (phase, counts, since) = state.withLock { ($0.phase, $0.counts, $0.since) }
                report(phase, counts, seconds: now - since, stuck: stuck)
                ChatProbe.quit()
            }
            guard now - lastTick >= 4 else { continue }
            lastTick = now
            let (counts, since) = state.withLock { state -> ([String: Int], Double) in
                defer {
                    state.counts = [:]
                    state.since = now
                }
                return (state.counts, state.since)
            }
            if !counts.isEmpty || stuck != nil {
                report("tick", counts, seconds: now - since, stuck: stuck)
            }
        }
    }
}
#endif
