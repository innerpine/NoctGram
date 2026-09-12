import { RainRenderer, type RainWorkerMessage } from './rain-renderer';

const renderers = new Map<number, RainRenderer>();
let frame = 0;
function wake() {
  let running = false;
  for (const renderer of renderers.values())
    if (renderer.ready) {
      running = true;
      break;
    }
  if (running && !frame) frame = requestAnimationFrame(tick);
  else if (!running && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}
function tick(now: number) {
  frame = 0;
  for (const renderer of renderers.values()) renderer.draw(now);
  wake();
}
globalThis.addEventListener(
  'message',
  (event: MessageEvent<RainWorkerMessage>) => {
    const message = event.data;
    try {
      if (message.type === 'attach') {
        renderers.set(
          message.id,
          new RainRenderer(message.canvas, message.scope, message.compact),
        );
      } else {
        const renderer = renderers.get(message.id);
        if (!renderer) return;
        if (message.type === 'layout') renderer.configure(message.layout);
        else if (message.type === 'options') renderer.update(message.options);
        else if (message.type === 'active') renderer.setActive(message.active);
        else {
          renderer.dispose();
          renderers.delete(message.id);
        }
      }
      wake();
    } catch {
      renderers.get(message.id)?.dispose();
      renderers.delete(message.id);
      globalThis.postMessage({ type: 'failed', id: message.id });
      wake();
    }
  },
);
let supported = false;
try {
  supported =
    typeof requestAnimationFrame === 'function' &&
    Boolean(new OffscreenCanvas(1, 1).getContext('2d'));
} catch {
  /* Let the page choose its fallback before transferring its canvas. */
}
globalThis.postMessage({ type: 'ready', supported });
