import type Hls from 'hls.js';

export const nativeMusicPlayback = (playback?: string) =>
  playback === 'file' || playback === 'soundcloud';
export const soundcloudAudioURL = (url: string) =>
  '/api/music/soundcloud?action=stream&url=' + encodeURIComponent(url);
// Chromium can report "maybe" for HLS even where its native pipeline cannot
// decode it. Safari/iOS uses native HLS; other browsers use the MSE adapter.
export const prefersNativeHls = (userAgent: string) =>
  /AppleWebKit/.test(userAgent) &&
  !/Chrome|Chromium|Android|Edg\//.test(userAgent);

/** Owns one audio element for the lifetime of the provider, including queue
 * changes. Safari receives its new source and play() directly inside the tap. */
export class NativeMusicAudio {
  private hls: Hls | null = null;
  private generation = 0;
  private source = '';
  private sourcePending = false;
  intendsToPlay = false;
  failure = '';
  get hasMetadata() {
    return !this.sourcePending && this.element.readyState >= 1;
  }
  get positionMs() {
    return this.hasMetadata && Number.isFinite(this.element.currentTime)
      ? Math.max(0, this.element.currentTime * 1000)
      : 0;
  }
  constructor(
    private element: HTMLAudioElement,
    private loadHls = () => import('hls.js'),
    private nativeHls = () =>
      !!element.canPlayType('application/vnd.apple.mpegurl') &&
      prefersNativeHls(navigator.userAgent),
  ) {
    element.setAttribute('playsinline', '');
  }
  load(source: string, hls: boolean, autoplay: boolean, force = false) {
    this.intendsToPlay = autoplay;
    if (source === this.source && !force) {
      if (autoplay && this.hasMetadata) this.resume();
      return;
    }
    this.failure = '';
    this.source = source;
    // HLS imports asynchronously: the element can still expose the previous
    // track's time/metadata until loadSource replaces its MediaSource.
    this.sourcePending = true;
    const generation = ++this.generation;
    if (!hls || this.nativeHls()) {
      this.hls?.destroy();
      this.hls = null;
      this.element.src = source;
      this.element.load();
      this.sourcePending = false;
      if (autoplay) this.resume();
      return;
    }
    void this.loadHls()
      .then(({ default: Engine }) => {
        if (generation !== this.generation) return;
        if (!Engine.isSupported()) {
          this.failed('Этот браузер не поддерживает аудиопоток.');
          return;
        }
        if (!this.hls) {
          const engine = new Engine({
            enableWorker: true,
            maxBufferLength: 30,
            backBufferLength: 30,
          });
          this.hls = engine;
          engine.on(Engine.Events.MANIFEST_PARSED, () => {
            if (this.hls === engine && this.intendsToPlay) this.resume();
          });
          engine.on(Engine.Events.ERROR, (_event, data) => {
            if (this.hls === engine && data.fatal)
              this.failed(
                'Не удалось загрузить аудиопоток. Нажмите «Повторить».',
              );
          });
          engine.attachMedia(this.element);
        }
        this.hls.loadSource(source);
        this.sourcePending = false;
      })
      .catch(() => {
        if (generation === this.generation)
          this.failed('Не удалось загрузить аудиоплеер. Нажмите «Повторить».');
      });
  }
  resume() {
    this.intendsToPlay = true;
    if (this.sourcePending) return;
    const generation = this.generation;
    void this.element.play().catch((error: DOMException) => {
      if (
        generation !== this.generation ||
        !this.intendsToPlay ||
        error.name === 'AbortError'
      )
        return;
      if (error.name === 'NotAllowedError')
        this.element.dispatchEvent(new Event('noctgram:audio-blocked'));
      else this.failed('Не удалось запустить аудио. Нажмите «Повторить».');
    });
  }
  pause() {
    this.intendsToPlay = false;
    this.element.pause();
  }
  private failed(message: string) {
    this.failure = message;
    this.element.dispatchEvent(new Event('noctgram:audio-error'));
  }
  dispose() {
    ++this.generation;
    this.sourcePending = true;
    this.pause();
    this.hls?.destroy();
    this.hls = null;
    this.source = '';
    this.element.removeAttribute('src');
    this.element.load();
    this.sourcePending = false;
  }
}
