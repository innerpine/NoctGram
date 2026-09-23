export const MOBILE_NAV_QUERY = '(max-width: 500px)';

export function isAppleTouchDevice(
  device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
) {
  return (
    /iPhone|iPad|iPod/.test(device.userAgent) ||
    (device.platform === 'MacIntel' && device.maxTouchPoints > 1)
  );
}

/** Only transforms are written inside the frame loop. Retargeting preserves
 * velocity; resizing, backgrounding and reduced motion settle immediately.
 * The glass pill's damping ratio is 0.8 (32 / 2√400): a tap carries no
 * momentum, so it settles with ~1.5 % overshoot rather than bouncing. */
export function createNavSpring(
  host: Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>,
  render: (x: number) => void,
  elastic: boolean,
) {
  let x = 0,
    velocity = 0,
    target = 0,
    frame = 0,
    previous = 0;
  let disposed = false;
  const stop = () => {
    host.cancelAnimationFrame(frame);
    frame = 0;
    previous = 0;
    velocity = 0;
  };
  const finish = () => {
    stop();
    x = target;
    render(x);
  };
  const tick = (time: number) => {
    frame = 0;
    let dt = previous ? Math.min((time - previous) / 1000, 0.04) : 1 / 120;
    previous = time;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      velocity +=
        ((elastic ? 400 : 625) * (target - x) -
          (elastic ? 32 : 50) * velocity) *
        h;
      x += velocity * h;
      dt -= h;
    }
    if (Math.abs(target - x) < 0.06 && Math.abs(velocity) < 0.5) {
      finish();
      return;
    }
    render(x);
    frame = host.requestAnimationFrame(tick);
  };
  return {
    move(next: number, animate: boolean) {
      if (disposed) return;
      target = next;
      if (!animate) finish();
      else if (!frame && Math.abs(target - x) > 0.06)
        frame = host.requestAnimationFrame(tick);
    },
    finish,
    dispose() {
      disposed = true;
      stop();
    },
  };
}

export function createMobileNavigation(
  nav: HTMLElement,
  host: Window & typeof globalThis = window,
) {
  const pill = nav.querySelector<HTMLElement>('.mobile-nav-pill')!;
  const shape = nav.querySelector<HTMLElement>('.mobile-nav-pill-shape')!;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[data-nav]')];
  const mobile = host.matchMedia(MOBILE_NAV_QUERY);
  const reduced = host.matchMedia('(prefers-reduced-motion: reduce)');
  const doc = host.document;
  const apple = isAppleTouchDevice(host.navigator);
  const spring = createNavSpring(
    host,
    (x) => {
      pill.style.transform = `translate3d(${x}px, 0, 0)`;
    },
    apple,
  );
  let selected = '',
    positioned = false,
    target = 0;
  let shapeAnimation: Animation | undefined;
  let iconAnimation: Animation | undefined;
  nav.dataset.navSurface = apple ? 'glass' : 'matte';

  const cancelEffects = () => {
    shapeAnimation?.cancel();
    iconAnimation?.cancel();
    shapeAnimation = iconAnimation = undefined;
  };
  const canAnimate = () => mobile.matches && !reduced.matches && !doc.hidden;
  const bounce = (link: HTMLAnchorElement) => {
    if (!apple || !canAnimate()) return;
    iconAnimation?.cancel();
    iconAnimation = link
      .querySelector('.nav-item-icon')
      ?.animate?.(
        [
          { transform: 'translateY(0) scale(1)' },
          { transform: 'translateY(-1.6px) scale(1.1)', offset: 0.3 },
          { transform: 'translateY(0.6px) scale(0.97)', offset: 0.62 },
          { transform: 'translateY(0) scale(1)' },
        ],
        { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
      );
  };
  const position = (animate: boolean) => {
    const link = links.find((item) => item.dataset.nav === selected);
    if (!mobile.matches || !link || !link.offsetWidth) {
      spring.finish();
      cancelEffects();
      positioned = false;
      delete nav.dataset.navEnhanced;
      return;
    }
    // Use measured cells, including the mobile-only channel/message order.
    const width = link.offsetWidth;
    const next = link.offsetLeft;
    const distance = Math.abs(next - target);
    pill.style.width = `${width}px`;
    const moving = animate && positioned && canAnimate();
    spring.move(next, moving);
    cancelEffects();
    if (moving && apple && distance > 1) {
      // Liquid stretch on the way, one soft rebound, no wobble (matches the
      // near-critical spring above).
      const stretch = 1.06 + Math.min(distance / width, 3) / 90;
      shapeAnimation = shape.animate?.(
        [
          { transform: 'translateY(0) scale(1)' },
          {
            transform: `translateY(0.9px) scale(${stretch}, .93)`,
            offset: 0.2,
          },
          { transform: 'translateY(-0.4px) scale(.975, 1.015)', offset: 0.5 },
          { transform: 'translateY(0) scale(1)' },
        ],
        { duration: 420, easing: 'ease-out' },
      );
      bounce(link);
    }
    target = next;
    positioned = true;
    nav.dataset.navEnhanced = 'true';
  };
  const measure = () => position(false);
  const observer = host.ResizeObserver
    ? new host.ResizeObserver(measure)
    : undefined;
  observer?.observe(nav);
  if (!observer) host.addEventListener('resize', measure);
  const visibility = () => {
    spring.finish();
    cancelEffects();
    if (!doc.hidden) measure();
  };
  const click = (event: MouseEvent) => {
    if (
      event.button ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      'a[data-nav]',
    );
    if (link?.dataset.nav === selected) bounce(link);
  };
  mobile.addEventListener('change', measure);
  reduced.addEventListener('change', measure);
  doc.addEventListener('visibilitychange', visibility);
  nav.addEventListener('click', click);
  return {
    select(id: string) {
      if (id === selected) return;
      selected = id;
      position(true);
    },
    dispose() {
      observer?.disconnect();
      if (!observer) host.removeEventListener('resize', measure);
      spring.dispose();
      cancelEffects();
      mobile.removeEventListener('change', measure);
      reduced.removeEventListener('change', measure);
      doc.removeEventListener('visibilitychange', visibility);
      nav.removeEventListener('click', click);
      delete nav.dataset.navEnhanced;
      delete nav.dataset.navSurface;
    },
  };
}
