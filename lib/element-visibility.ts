type Listener = (visible: boolean) => void;
function visibilityPool(minimumRatio = 0) {
  const targets = new Map<
    Element,
    { visible: boolean; listeners: Set<Listener> }
  >();
  let observer: IntersectionObserver | undefined;
  const publish = () =>
    targets.forEach((entry) =>
      entry.listeners.forEach((listener) =>
        listener(entry.visible && !document.hidden),
      ),
    );

  /** One observer and one visibility listener for every decorative avatar/ring. */
  function observeElementVisibility(element: Element, listener: Listener) {
    if (!observer) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const target = targets.get(entry.target);
            if (target) {
              target.visible =
                entry.isIntersecting &&
                (minimumRatio === 0 || entry.intersectionRatio >= minimumRatio);
              target.listeners.forEach((callback) =>
                callback(target.visible && !document.hidden),
              );
            }
          }
        },
        { threshold: minimumRatio ? [0, minimumRatio] : 0 },
      );
      document.addEventListener('visibilitychange', publish);
    }
    let target = targets.get(element);
    if (!target) {
      target = { visible: false, listeners: new Set() };
      targets.set(element, target);
      observer.observe(element);
    }
    target.listeners.add(listener);
    listener(target.visible && !document.hidden);
    return () => {
      target.listeners.delete(listener);
      if (!target.listeners.size) {
        observer?.unobserve(element);
        targets.delete(element);
      }
      if (!targets.size) {
        observer?.disconnect();
        observer = undefined;
        document.removeEventListener('visibilitychange', publish);
      }
    };
  }
  return observeElementVisibility;
}
export const observeElementVisibility = visibilityPool();
// View accounting retains its existing 50% threshold and one-second dwell time.
export const observePostVisibility = visibilityPool(0.5);
