const musicPage = (page: string) =>
  page === 'music' || page === 'music-services';

/** Animate only a committed section change; playback stays in the existing DOM. */
export function createPageTransition(
  host: Window,
  flush: (update: () => void) => void,
) {
  let generation = 0;
  let current: ViewTransition | undefined;
  let fallback: Animation | undefined;
  const document = host.document;
  const clear = () =>
    document.documentElement.removeAttribute('data-page-transition');
  const cancel = () => {
    generation++;
    current?.skipTransition();
    current = undefined;
    fallback?.cancel();
    fallback = undefined;
    clear();
  };
  return {
    cancel,
    async run(from: string, to: string, update: () => void, enabled = true) {
      cancel();
      const version = generation;
      const commit = () => {
        if (generation === version) flush(update);
      };
      if (
        !enabled ||
        from === to ||
        (!musicPage(from) && !musicPage(to)) ||
        document.hidden
      ) {
        commit();
        return;
      }
      const enter = () => {
        const main = document.querySelector<HTMLElement>('.main-column');
        if (main?.animate && generation === version) {
          // Reduced motion keeps a short fade; the section no longer rises.
          fallback = host.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? main.animate([{ opacity: 0 }, { opacity: 1 }], {
                duration: 150,
                easing: 'ease',
              })
            : main.animate(
                [
                  { opacity: 0, translate: '0 10px' },
                  { opacity: 1, translate: '0 0' },
                ],
                { duration: 360, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
              );
        }
      };
      const reveal = () => {
        commit();
        if (generation !== version) return;
        // A section has one entrance. A snapshot taken at the start of a nested
        // card animation would otherwise stay transparent until the snapshot
        // disappears. Keep looping avatars / skeletons running normally.
        const main = document.querySelector<HTMLElement>('.main-column');
        for (const animation of main?.getAnimations?.({ subtree: true }) ||
          []) {
          const end = animation.effect?.getComputedTiming().endTime;
          if (typeof end === 'number' && Number.isFinite(end))
            animation.finish();
        }
        document.documentElement.setAttribute('data-page-transition', 'in');
      };
      // A snapshot of the phone navbar would freeze its live spring animation.
      // Animate the page alone so navigation remains interactive throughout.
      if (
        !document.startViewTransition ||
        host.matchMedia('(max-width: 500px)').matches
      ) {
        reveal();
        clear();
        enter();
        return;
      }
      document.documentElement.setAttribute('data-page-transition', 'out');
      try {
        current = document.startViewTransition(reveal);
      } catch {
        reveal();
        clear();
        enter();
        return;
      }
      const transition = current;
      // Skipping a visual transition still runs its update callback. The version
      // check above prevents a rapid second click from committing the old page.
      void transition.ready.catch(() => {
        if (generation === version) {
          clear();
          enter();
        }
      });
      void transition.finished
        .catch(() => {})
        .then(() => {
          if (generation === version) {
            current = undefined;
            clear();
          }
        });
      await transition.updateCallbackDone;
    },
  };
}
