import { encodeWaveform, waveformFromPeaks } from './voice-waveform';

export type RecordingKind = 'voice' | 'round';
export type RecordingResult = {
  file: File;
  kind: RecordingKind;
  duration: number;
  waveform: string;
  preview: string;
};
export const RECORD_MIN_MS = 500;
export const ROUND_LIMIT_MS = 60_000;
export const ROUND_SIZE = 384;

// MP4/AAC plays in every browser; WebM/Opus and Ogg/Opus are the fallbacks for
// browsers that cannot record AAC. The server checks the container signature.
// An MP4 without an explicit codec may hold Opus, so it comes after WebM.
const VOICE_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/webm',
];
const ROUND_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4',
  'video/webm',
];
export function pickRecorderType(
  kind: RecordingKind,
  isTypeSupported: (type: string) => boolean,
) {
  for (const type of kind === 'voice' ? VOICE_TYPES : ROUND_TYPES)
    if (isTypeSupported(type)) return type;
  return '';
}
export function recordingExtension(type: string) {
  const base = type.split(';')[0].trim().toLowerCase();
  if (base === 'audio/ogg') return 'ogg';
  if (base.endsWith('/webm')) return 'webm';
  if (base === 'audio/mp4') return 'm4a';
  if (base === 'audio/mpeg') return 'mp3';
  return 'mp4';
}
export function recordingSupport(kind: RecordingKind) {
  if (typeof window === 'undefined') return 'Запись недоступна';
  if (!window.isSecureContext)
    return 'Запись доступна только по защищённому соединению (HTTPS)';
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  )
    return 'Этот браузер не умеет записывать сообщения';
  if (
    kind === 'round' &&
    typeof HTMLCanvasElement.prototype.captureStream !== 'function'
  )
    return 'Этот браузер не умеет записывать видеосообщения';
  return '';
}
export function recordingError(error: unknown, kind: RecordingKind) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return kind === 'voice'
      ? 'Разрешите доступ к микрофону в настройках браузера'
      : 'Разрешите доступ к камере и микрофону в настройках браузера';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return kind === 'voice' ? 'Микрофон не найден' : 'Камера или микрофон не найдены';
  if (name === 'NotReadableError')
    return 'Устройство записи занято другим приложением';
  return error instanceof Error && error.message
    ? error.message
    : 'Не удалось начать запись';
}

// One recording session: microphone (and camera), live levels for the UI,
// a waveform for voice messages and a square 384×384 crop for round videos.
export class MediaRecording {
  readonly kind: RecordingKind;
  readonly stream: MediaStream;
  onLevel: ((level: number) => void) | null = null;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private peaks: number[] = [];
  private startedAt = 0;
  private stoppedAt = 0;
  private context: AudioContext | null = null;
  private meter = 0;
  private draw = 0;
  private camera: HTMLVideoElement | null = null;
  private tap: MediaStreamTrack | null = null;
  private finished = false;
  facingMode: 'user' | 'environment';

  private constructor(
    kind: RecordingKind,
    stream: MediaStream,
    recorder: MediaRecorder,
    facingMode: 'user' | 'environment',
  ) {
    this.kind = kind;
    this.stream = stream;
    this.recorder = recorder;
    this.facingMode = facingMode;
  }

  static async start(
    kind: RecordingKind,
    facingMode: 'user' | 'environment' = 'user',
  ) {
    const unsupported = recordingSupport(kind);
    if (unsupported) throw new Error(unsupported);
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === 'voice'
        ? { audio, video: false }
        : {
            audio,
            video: {
              facingMode,
              width: { ideal: 720 },
              height: { ideal: 720 },
              frameRate: { ideal: 30 },
            },
          },
    );
    try {
      const type = pickRecorderType(kind, (candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      let recordStream = stream;
      let camera: HTMLVideoElement | null = null;
      let draw = 0;
      if (kind === 'round') {
        camera = document.createElement('video');
        camera.muted = true;
        camera.playsInline = true;
        camera.srcObject = stream;
        await camera.play().catch(() => {});
        const canvas = document.createElement('canvas');
        canvas.width = ROUND_SIZE;
        canvas.height = ROUND_SIZE;
        const context = canvas.getContext('2d');
        const source = camera;
        // A timer keeps frames flowing in background tabs, unlike rAF.
        draw = window.setInterval(() => {
          if (!context || !source.videoWidth) return;
          const side = Math.min(source.videoWidth, source.videoHeight);
          context.drawImage(
            source,
            (source.videoWidth - side) / 2,
            (source.videoHeight - side) / 2,
            side,
            side,
            0,
            0,
            ROUND_SIZE,
            ROUND_SIZE,
          );
        }, 1000 / 30);
        recordStream = new MediaStream([
          ...canvas.captureStream(30).getVideoTracks(),
          ...stream.getAudioTracks(),
        ]);
      }
      const recorder = new MediaRecorder(recordStream, {
        ...(type ? { mimeType: type } : {}),
        ...(kind === 'voice'
          ? { audioBitsPerSecond: 64_000 }
          : { videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 64_000 }),
      });
      const session = new MediaRecording(kind, stream, recorder, facingMode);
      session.camera = camera;
      session.draw = draw;
      recorder.ondataavailable = (event) => {
        if (event.data.size) session.chunks.push(event.data);
      };
      session.listen();
      recorder.start(250);
      session.startedAt = performance.now();
      return session;
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  // Levels come from a cloned audio track: tapping the recorder's own track
  // can starve it in some browsers.
  private listen() {
    const track = this.stream.getAudioTracks()[0];
    const AudioContextType =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!track || !AudioContextType) return;
    try {
      this.tap = track.clone();
      this.context = new AudioContextType();
      const source = this.context.createMediaStreamSource(
        new MediaStream([this.tap]),
      );
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      this.meter = window.setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        let peak = 0;
        for (const value of data) peak = Math.max(peak, Math.abs(value));
        this.peaks.push(Math.round(Math.min(1, peak) * 32767));
        this.onLevel?.(Math.min(1, peak * 2.2));
      }, 50);
    } catch {
      /* The recording works without a live level. */
    }
  }

  elapsed() {
    return Math.round((this.stoppedAt || performance.now()) - this.startedAt);
  }

  // Replaces the camera without restarting the recorder: the canvas keeps
  // producing frames from whichever camera is attached.
  async flipCamera() {
    if (this.kind !== 'round' || !this.camera || this.finished) return;
    const facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    const next = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width: { ideal: 720 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    const [track] = next.getVideoTracks();
    for (const old of this.stream.getVideoTracks()) {
      this.stream.removeTrack(old);
      old.stop();
    }
    this.stream.addTrack(track);
    this.camera.srcObject = new MediaStream([track]);
    await this.camera.play().catch(() => {});
    this.facingMode = facingMode;
  }

  private release() {
    this.finished = true;
    this.stoppedAt ||= performance.now();
    window.clearInterval(this.meter);
    window.clearInterval(this.draw);
    this.tap?.stop();
    void this.context?.close().catch(() => {});
    this.stream.getTracks().forEach((track) => track.stop());
    if (this.camera) this.camera.srcObject = null;
  }

  cancel() {
    if (this.finished) return;
    this.recorder.ondataavailable = null;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.chunks = [];
    this.release();
  }

  // Resolves with the file, or null when the recording is too short.
  async stop(): Promise<RecordingResult | null> {
    if (this.finished) return null;
    this.stoppedAt = performance.now();
    const done = new Promise<void>((resolve) => {
      this.recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    await done;
    const duration = Math.min(
      this.elapsed(),
      this.kind === 'round' ? ROUND_LIMIT_MS : Number.MAX_SAFE_INTEGER,
    );
    this.release();
    if (duration < RECORD_MIN_MS || !this.chunks.length) return null;
    const type = (this.recorder.mimeType || this.chunks[0].type || '')
      .split(';')[0]
      .trim();
    const blob = new Blob(this.chunks, { type });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '');
    const file = new File(
      [blob],
      `${this.kind === 'voice' ? 'voice' : 'video-message'}-${stamp}.${recordingExtension(type)}`,
      { type },
    );
    return {
      file,
      kind: this.kind,
      duration,
      waveform:
        this.kind === 'voice' ? encodeWaveform(waveformFromPeaks(this.peaks)) : '',
      preview: URL.createObjectURL(blob),
    };
  }
}
