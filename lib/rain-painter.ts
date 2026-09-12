import { defaultRainOptions, type RainOptions } from './rain-options';
import {
  RainRenderer,
  type RainLayout,
  type RainScope,
  type RainWorkerMessage,
} from './rain-renderer';

type Session = {
  worker: Worker;
  ready: Promise<boolean>;
  users: Map<number, () => void>;
  close: () => void;
};
let shared: Session | undefined;
let sequence = 0;

function acquire() {
  if (shared) return shared;
  const worker = new Worker(new URL('./rain-worker.ts', import.meta.url), {
    type: 'module',
  });
  let settle!: (supported: boolean) => void;
  let finished = false;
  const ready = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const session: Session = {
    worker,
    ready,
    users: new Map(),
    close() {
      clearTimeout(timeout);
      worker.terminate();
      if (!finished) {
        finished = true;
        settle(false);
      }
      if (shared === session) shared = undefined;
    },
  };
  function failed() {
    session.close();
    for (const fallback of session.users.values()) fallback();
  }
  const timeout = setTimeout(failed, 1500);
  worker.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'ready' && !finished) {
      if (!event.data.supported) {
        failed();
        return;
      }
      clearTimeout(timeout);
      finished = true;
      settle(true);
    } else if (event.data?.type === 'failed') {
      session.users.get(event.data.id)?.();
    }
  };
  worker.onerror = failed;
  worker.onmessageerror = failed;
  shared = session;
  return session;
}

// A single worker renders all rain surfaces. The UI only sends changed layout,
// options and visibility; it never forwards individual animation frames.
export function createRainPainter(
  canvas: HTMLCanvasElement,
  scope: RainScope,
  compact: boolean,
  changed: () => void,
  failedAfterTransfer: () => void,
  forceMain: boolean,
) {
  let local: RainRenderer | undefined;
  let session: Session | undefined;
  let transferred = false;
  let disposed = false;
  let failed = false;
  let active = false;
  let layout: RainLayout | undefined;
  let options = defaultRainOptions;
  const id = ++sequence;
  function release() {
    if (!session) return;
    session.users.delete(id);
    if (!session.users.size) session.close();
    session = undefined;
  }
  function fallback() {
    if (disposed || local || failed) return;
    release();
    if (transferred) {
      failed = true;
      failedAfterTransfer(); // React supplies a fresh canvas for main-thread recovery.
      return;
    }
    try {
      local = new RainRenderer(canvas, scope, compact);
      local.update(options);
      if (layout) local.configure(layout);
      local.setActive(active);
      changed();
    } catch {
      failed = true;
      // A development refresh can reuse a canvas transferred by the previous
      // effect instance. Recovery must replace that DOM canvas before retrying.
      if (!forceMain) failedAfterTransfer();
    }
  }
  function send(message: RainWorkerMessage, transfer: Transferable[] = []) {
    try {
      session?.worker.postMessage(message, transfer);
    } catch {
      fallback();
    }
  }
  if (
    !forceMain &&
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof canvas.transferControlToOffscreen === 'function'
  ) {
    try {
      const connection = acquire();
      session = connection;
      connection.users.set(id, fallback);
      void connection.ready.then((supported) => {
        if (disposed || failed || local) return;
        if (!supported) {
          fallback();
          return;
        }
        try {
          const offscreen = canvas.transferControlToOffscreen();
          transferred = true;
          send({ type: 'attach', id, canvas: offscreen, scope, compact }, [
            offscreen,
          ]);
          send({ type: 'options', id, options });
          if (layout) send({ type: 'layout', id, layout });
          send({ type: 'active', id, active });
          changed();
        } catch {
          fallback();
        }
      });
    } catch {
      fallback();
    }
  } else fallback();
  return {
    get needsFrame() {
      return Boolean(local?.ready);
    },
    configure(value: RainLayout) {
      if (disposed || failed) return;
      layout = value;
      local?.configure(value);
      if (transferred) send({ type: 'layout', id, layout });
    },
    update(value: RainOptions) {
      if (disposed || failed) return;
      options = value;
      local?.update(options);
      if (transferred) send({ type: 'options', id, options });
    },
    setActive(value: boolean) {
      if (disposed || failed || active === value) return;
      active = value;
      local?.setActive(active);
      if (transferred) send({ type: 'active', id, active });
    },
    draw(now: number) {
      local?.draw(now);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (transferred && !failed) send({ type: 'dispose', id });
      local?.dispose();
      release();
    },
  };
}
