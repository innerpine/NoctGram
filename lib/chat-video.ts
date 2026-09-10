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
