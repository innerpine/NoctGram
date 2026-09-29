import SwiftUI
import UIKit

/// Voice and round video recording of a chat, as in Telegram and the web
/// (app/chat-recorder.tsx): a tap on the button switches between the
/// microphone and the camera, holding records, sliding left cancels and
/// sliding up locks the recording so the finger can let go.
@MainActor
final class MessageRecorder: ObservableObject {
    enum Mode { case voice, round }
    enum Phase { case idle, starting, holding, locked }

    @Published var mode: Mode = .voice
    @Published private(set) var phase: Phase = .idle
    /// How far the finger moved from the button while holding.
    @Published private(set) var shift: CGSize = .zero
    /// A short hint after a tap («Удерживайте, чтобы записать…»).
    @Published private(set) var hint: String?

    let voice = VoiceRecorder()
    let round = RoundRecorder()
    var sendVoice: ((VoiceRecorder.Recording) -> Void)?
    var sendRound: ((RoundRecorder.Recording) -> Void)?
    var report: ((String) -> Void)?

    static let cancelDistance: CGFloat = 120
    static let lockDistance: CGFloat = 90

    private var holdTask: Task<Void, Never>?
    private var hintTask: Task<Void, Never>?
    private var released = false
    private var limitWatch: Task<Void, Never>?

    var active: Bool { phase != .idle }
    var elapsed: Double { mode == .voice ? voice.elapsed : round.elapsed }

    /// The finger went down on the button: recording starts if it stays.
    func press() {
        guard phase == .idle, holdTask == nil else { return }
        released = false
        shift = .zero
        holdTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard let self, !Task.isCancelled else { return }
            self.holdTask = nil
            await self.begin()
        }
    }

    func move(_ translation: CGSize) {
        guard phase == .holding else { return }
        shift = CGSize(width: min(0, translation.width), height: min(0, translation.height))
        if translation.width < -Self.cancelDistance {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            cancel()
        } else if translation.height < -Self.lockDistance {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            phase = .locked
            shift = .zero
        }
    }

    /// The finger let go: a quick tap switches the mode, a hold sends.
    func release() {
        released = true
        if let holdTask {
            holdTask.cancel()
            self.holdTask = nil
            toggleMode()
            return
        }
        switch phase {
        case .holding: finish()
        case .starting, .locked, .idle: break
        }
        shift = .zero
    }

    func toggleMode() {
        mode = mode == .voice ? .round : .voice
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        show(mode == .voice ? "Удерживайте, чтобы записать голосовое сообщение." : "Удерживайте, чтобы записать видеосообщение.")
    }

    private func show(_ text: String) {
        hint = text
        hintTask?.cancel()
        hintTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            guard !Task.isCancelled else { return }
            self?.hint = nil
        }
    }

    private func begin() async {
        phase = .starting
        let kind = mode
        let allowed: Bool
        if kind == .voice {
            allowed = await VoiceRecorder.permission()
        } else {
            allowed = await RoundRecorder.permission()
        }
        guard allowed else {
            phase = .idle
            report?(kind == .voice
                ? "Разреши Noctgram доступ к микрофону в Настройках, чтобы записывать голосовые сообщения."
                : "Разреши Noctgram доступ к камере и микрофону в Настройках, чтобы записывать видеосообщения.")
            return
        }
        // The finger let go while the permission was asked for.
        if released {
            phase = .idle
            return
        }
        do {
            if kind == .voice {
                try voice.start()
            } else {
                try round.prepare()
                round.start()
                watchLimit()
            }
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            phase = .holding
        } catch {
            phase = .idle
            round.cancel()
            voice.cancel()
            report?(error.userMessage ?? "Не удалось начать запись.")
        }
    }

    /// A round video stops at a minute and is sent, as in Telegram.
    private func watchLimit() {
        limitWatch?.cancel()
        limitWatch = Task { [weak self] in
            while let self, !Task.isCancelled, self.phase != .idle {
                if self.round.reachedLimit {
                    self.finish()
                    return
                }
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
        }
    }

    /// Stops and sends what was recorded.
    func finish() {
        let kind = mode
        phase = .idle
        shift = .zero
        limitWatch?.cancel()
        if kind == .voice {
            if let recording = voice.finish() {
                sendVoice?(recording)
            } else {
                show("Слишком короткое голосовое сообщение.")
            }
        } else {
            Task {
                if let recording = await round.finish() {
                    sendRound?(recording)
                } else {
                    report?("Видеосообщение не записалось. Попробуй ещё раз.")
                }
            }
        }
    }

    func cancel() {
        holdTask?.cancel()
        holdTask = nil
        limitWatch?.cancel()
        voice.cancel()
        round.cancel()
        phase = .idle
        shift = .zero
    }
}

/// The composer of a chat as in Telegram for iOS: the paperclip, the field
/// with the sticker button inside, and on the right the microphone (or the
/// camera) that becomes the send button once there is text.
struct ChatComposer: View {
    @Binding var text: String
    var placeholder = "Сообщение"
    var focus: FocusState<Bool>.Binding
    var accent: Color
    /// The paperclip; nil while a message is being edited.
    var attach: AnyView?
    /// The sticker and emoji panel is open in place of the keyboard.
    @Binding var panel: Bool
    /// Nil while editing: only text can be sent.
    var recorder: MessageRecorder?
    /// Attachments wait to be sent without text.
    var hasAttachments = false
    let send: () -> Void

    var body: some View {
        if let recorder {
            RecorderAwareComposer(composer: self, recorder: recorder)
        } else {
            row(recorder: nil)
        }
    }

    fileprivate var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || hasAttachments
    }

    fileprivate func row(recorder: MessageRecorder?) -> some View {
        GlassGroup(spacing: 6) {
            HStack(alignment: .bottom, spacing: 8) {
                // The field stays under the recording strip, so the keyboard
                // (and the button under the finger) does not move.
                let recording = recorder?.active ?? false
                ZStack(alignment: .bottom) {
                    HStack(alignment: .bottom, spacing: 8) {
                        if let attach { attach }
                        field
                    }
                    .opacity(recording ? 0 : 1)
                    .allowsHitTesting(!recording)
                    .accessibilityHidden(recording)
                    if let recorder, recording {
                        RecordingStrip(recorder: recorder, accent: accent)
                    }
                }
                if let recorder, !canSend || recorder.active {
                    RecordButton(recorder: recorder, accent: accent)
                } else {
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 17, weight: .bold))
                    }
                    .buttonStyle(CircleButtonStyle(size: 44, tint: canSend ? accent : nil))
                    .disabled(!canSend)
                    .accessibilityLabel("Отправить")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    private var field: some View {
        HStack(alignment: .bottom, spacing: 0) {
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(1...6)
                .font(.system(size: 16))
                .focused(focus)
                .accessibilityIdentifier("composer-field")
                .padding(.leading, 16)
                .padding(.vertical, 11)
            Button {
                if panel {
                    panel = false
                    focus.wrappedValue = true
                } else {
                    focus.wrappedValue = false
                    panel = true
                }
            } label: {
                Image(systemName: panel ? "keyboard" : "face.smiling")
                    .font(.system(size: 20))
                    .foregroundColor(Noct.text60)
                    .frame(width: 40, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle())
            .accessibilityIdentifier("composer-stickers")
            .accessibilityLabel(panel ? "Клавиатура" : "Стикеры и эмодзи")
        }
        .frame(minHeight: 44)
        .glassRect(22)
    }
}

/// Observes the recorder so the row follows its phase.
private struct RecorderAwareComposer: View {
    let composer: ChatComposer
    @ObservedObject var recorder: MessageRecorder

    var body: some View {
        composer.row(recorder: recorder)
            .overlay(alignment: .top) {
                if let hint = recorder.hint {
                    Text(hint)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .glassCapsule()
                        .offset(y: -44)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                        .allowsHitTesting(false)
                }
            }
            .animation(Noct.quick, value: recorder.hint)
            .animation(Noct.quick, value: recorder.phase)
    }
}

/// The microphone or camera on the right: a tap switches, holding records.
/// While recording it grows under the finger, with the lock above it.
private struct RecordButton: View {
    @ObservedObject var recorder: MessageRecorder
    let accent: Color
    @GestureState private var pressing = false

    var body: some View {
        ZStack {
            if recorder.phase == .locked {
                Button {
                    recorder.finish()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                }
                .buttonStyle(CircleButtonStyle(size: 44, tint: accent))
                .accessibilityLabel("Отправить запись")
            } else {
                Image(systemName: recorder.mode == .voice ? "mic.fill" : "video.fill")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
                    .glassCircle(interactive: true)
                    .overlay {
                        if recorder.phase == .holding {
                            Circle()
                                .fill(accent)
                                .frame(width: 84, height: 84)
                                .overlay(
                                    Image(systemName: recorder.mode == .voice ? "mic.fill" : "video.fill")
                                        .font(.system(size: 26, weight: .medium))
                                        .foregroundColor(.black.opacity(0.85))
                                )
                                .offset(x: recorder.shift.width, y: recorder.shift.height)
                                .transition(.scale.combined(with: .opacity))
                        }
                    }
                    .overlay(alignment: .top) {
                        if recorder.phase == .holding {
                            LockPill(progress: min(1, -recorder.shift.height / MessageRecorder.lockDistance))
                                .offset(y: -118 + max(-40, recorder.shift.height / 2))
                                .transition(.opacity)
                        }
                    }
                    .gesture(hold)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("composer-record")
                    .accessibilityLabel(recorder.mode == .voice ? "Голосовое сообщение" : "Видеосообщение")
                    .accessibilityHint("Нажми, чтобы переключить, удерживай, чтобы записать")
                    .accessibilityAction(named: recorder.mode == .voice ? "Видеосообщение" : "Голосовое сообщение") {
                        recorder.toggleMode()
                    }
            }
        }
        .frame(width: 44, height: 44)
    }

    private var hold: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .updating($pressing) { _, state, _ in state = true }
            .onChanged { value in
                if recorder.phase == .idle { recorder.press() }
                recorder.move(value.translation)
            }
            .onEnded { _ in recorder.release() }
    }
}

/// The lock above the held button: sliding up to it locks the recording.
private struct LockPill: View {
    let progress: CGFloat

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: progress >= 1 ? "lock.fill" : "lock.open.fill")
                .font(.system(size: 15, weight: .semibold))
            Image(systemName: "chevron.up")
                .font(.system(size: 11, weight: .bold))
                .opacity(1 - progress)
        }
        .foregroundColor(Noct.text75)
        .frame(width: 38, height: 64)
        .glassCapsule()
        .allowsHitTesting(false)
    }
}

/// In place of the field while recording: the red dot, the time and
/// «Влево — отмена», or «Отмена» once the recording is locked.
private struct RecordingStrip: View {
    @ObservedObject var recorder: MessageRecorder
    let accent: Color

    var body: some View {
        HStack(spacing: 10) {
            TimerLabel(recorder: recorder, voice: recorder.voice, round: recorder.round)
            Spacer(minLength: 4)
            if recorder.phase == .locked {
                Button("Отмена") { recorder.cancel() }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(accent)
                    .accessibilityIdentifier("recording-cancel")
            } else {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
                    Text("Влево — отмена").font(.system(size: 15))
                }
                .foregroundColor(Noct.text60)
                .offset(x: recorder.shift.width * 0.6)
                .opacity(1 - min(0.8, -recorder.shift.width / MessageRecorder.cancelDistance))
            }
            Spacer(minLength: 4)
        }
        .padding(.leading, 16)
        .padding(.trailing, 10)
        .frame(height: 44)
        .glassRect(22)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("recording-strip")
    }
}

private struct TimerLabel: View {
    @ObservedObject var recorder: MessageRecorder
    @ObservedObject var voice: VoiceRecorder
    @ObservedObject var round: RoundRecorder
    @State private var blink = false

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Noct.red)
                .frame(width: 9, height: 9)
                .opacity(blink ? 0.25 : 1)
                .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: blink)
                .onAppear { blink = true }
            Text(Waveform.clock(recorder.mode == .voice ? voice.elapsed : round.elapsed, tenths: true))
                .font(.system(size: 16).monospacedDigit())
                .foregroundColor(.white)
        }
    }
}

/// The camera circle over the dimmed chat while a round video records.
struct RoundCaptureOverlay: View {
    @ObservedObject var recorder: MessageRecorder
    @ObservedObject var round: RoundRecorder
    let accent: Color

    var body: some View {
        GeometryReader { geometry in
            let side = min(geometry.size.width - 56, 340)
            ZStack {
                Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
                Color.black.opacity(0.4).ignoresSafeArea()
                VStack(spacing: 22) {
                    ZStack {
                        CameraPreview(session: round.session)
                            .frame(width: side, height: side)
                            .clipShape(Circle())
                        Circle()
                            .trim(from: 0, to: CGFloat(round.elapsed / RoundRecorder.limit))
                            .stroke(accent, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .frame(width: side + 14, height: side + 14)
                            .animation(.linear(duration: 0.1), value: round.elapsed)
                    }
                    if recorder.phase == .locked {
                        Button {
                            round.flip()
                        } label: {
                            Image(systemName: "arrow.triangle.2.circlepath.camera")
                                .font(.system(size: 18, weight: .medium))
                        }
                        .buttonStyle(CircleButtonStyle(size: 46))
                        .accessibilityLabel("Сменить камеру")
                    }
                }
                .position(x: geometry.size.width / 2, y: geometry.size.height * 0.42)
            }
        }
        .transition(.opacity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Запись видеосообщения")
    }
}
