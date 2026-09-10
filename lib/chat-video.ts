export function readVideoState(video: HTMLVideoElement) {
  const duration = Number.isFinite(video.duration)
    ? Math.max(0, video.duration)
    : 0;
  const position = Math.max(0, Math.min(duration, video.currentTime || 0));
  let buffered = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (
      video.buffered.start(i) <= position &&
      video.buffered.end(i) >= position
    )
      buffered = Math.min(duration, video.buffered.end(i));
  }
  return {
    duration,
    position,
    buffered,
    paused: video.paused || video.ended,
    ended: video.ended,
    muted: video.muted,
    volume: video.volume,
  };
}
export function seekVideo(video: HTMLVideoElement, position: number) {
  if (
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    !Number.isFinite(position)
  )
    return;
  video.currentTime = Math.max(0, Math.min(video.duration, position));
}
const activeVideos = new WeakMap<Document, HTMLVideoElement>();
export function claimVideoPlayback(video: HTMLVideoElement) {
  const previous = activeVideos.get(video.ownerDocument);
  if (previous && previous !== video) previous.pause();
  activeVideos.set(video.ownerDocument, video);
}
export type VideoPlayback = {
  position: number;
  volume: number;
  muted: boolean;
  playing: boolean;
};
export function captureVideoPlayback(video: HTMLVideoElement): VideoPlayback {
  const state = readVideoState(video);
  return {
    position: state.position,
    volume: state.volume,
    muted: state.muted,
    playing: !state.paused,
  };
}
export function restoreVideoPosition(
  video: HTMLVideoElement,
  state: VideoPlayback,
) {
  seekVideo(video, state.position);
  video.volume = state.volume;
  video.muted = state.muted;
}
export type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};
export async function toggleVideoFullscreen(
  root: HTMLElement,
  video: FullscreenVideo,
) {
  if (root.ownerDocument.fullscreenElement === root) {
    await root.ownerDocument.exitFullscreen();
  } else if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) {
    video.webkitExitFullscreen();
  } else {
    try {
      if (!root.requestFullscreen) throw new Error('Fullscreen unavailable');
      await root.requestFullscreen();
    } catch (error) {
      if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else throw error;
    }
  }
}
