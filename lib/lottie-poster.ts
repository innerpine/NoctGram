import { animationData } from './gift-animation-runtime';

// First frames of animated stickers made by people, for grids where only a
// few animations play at once. Built-in stickers ship ready posters instead.
// One frame is drawn at a time; the newest results stay in memory.
const posters = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
const LIMIT = 150;

async function draw(id: string, size: number) {
  const data = await animationData(id);
  const lottie = (await import('lottie-web/build/player/lottie_light_canvas'))
    .default;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  const animation = lottie.loadAnimation<'canvas'>({
    // Draws into the canvas above; the detached container is never shown.
    container: document.createElement('div'),
    renderer: 'canvas',
    loop: false,
    autoplay: false,
    animationData: structuredClone(data),
    rendererSettings: {
      context,
      clearCanvas: true,
      preserveAspectRatio: 'xMidYMid meet',
    },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      if (animation.isLoaded) return resolve();
      animation.addEventListener('DOMLoaded', () => resolve());
      animation.addEventListener('data_failed', () =>
        reject(new Error('Animation unavailable')),
      );
    });
    animation.resize();
    animation.goToAndStop(0, true);
    return canvas.toDataURL('image/webp', 0.85);
  } finally {
    animation.destroy();
  }
}
export function lottiePoster(id: string, size = 160) {
  const key = id + '@' + size;
  const cached = posters.get(key);
  if (cached) {
    posters.delete(key);
    posters.set(key, cached);
    return cached;
  }
  const task = queue.then(() => draw(id, size));
  queue = task.catch(() => {});
  posters.set(key, task);
  task.catch(() => {
    if (posters.get(key) === task) posters.delete(key);
  });
  if (posters.size > LIMIT) posters.delete(posters.keys().next().value!);
  return task;
}
