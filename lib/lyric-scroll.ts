/** One short animation per lyric change; no React updates or layout reads per frame. */
export function centerLyric(
  container: HTMLElement,
  line: HTMLElement,
  animate: boolean,
  host: Pick<
    Window,
    'requestAnimationFrame' | 'cancelAnimationFrame' | 'performance'
  > = window,
) {
  const from = container.scrollTop;
  const target = Math.max(
    0,
    Math.min(
      container.scrollHeight - container.clientHeight,
      line.offsetTop - (container.clientHeight - line.offsetHeight) / 2,
    ),
  );
  let frame = 0;
  let canceled = false;
  const cancel = () => {
    canceled = true;
    host.cancelAnimationFrame(frame);
  };
  if (!animate || Math.abs(target - from) < 1) {
    container.scrollTop = target;
    return cancel;
  }
  const started = host.performance.now();
  const duration = 480;
  const step = (now: number) => {
    if (canceled) return;
    const progress = Math.min(1, Math.max(0, (now - started) / duration));
    container.scrollTop = from + (target - from) * (1 - (1 - progress) ** 3);
    if (progress < 1) frame = host.requestAnimationFrame(step);
  };
  frame = host.requestAnimationFrame(step);
  return cancel;
}
