'use client';
/* Gesture callbacks read the latest options without re-attaching listeners. */
/* eslint-disable react/react-compiler */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  attachViewerGesture,
  originTransform,
  type ViewerGestureOptions,
} from '@/lib/viewer-gesture';

type Options = Omit<ViewerGestureOptions, 'backdrop'> & {
  open: boolean;
  /** Thumbnail the viewer grows from and returns to. */
  origin?: () => Element | null;
};

/** Wires a Base UI dialog popup to the viewer gestures; returns the popup ref. */
export function useViewerGesture({ open, origin, ...options }: Options) {
  const [popup, setPopup] = useState<HTMLElement | null>(null);
  const latest = useRef({ ...options, origin });
  latest.current = { ...options, origin };
  const gesture = useRef<ReturnType<typeof attachViewerGesture> | null>(null);
  useEffect(() => {
    if (!popup) return;
    const read = latest;
    const attached = attachViewerGesture(popup, {
      accepts: (target, type) => read.current.accepts(target, type),
      onDismiss: () => read.current.onDismiss(),
      get dismiss() {
        return read.current.dismiss;
      },
      get zoom() {
        return read.current.zoom;
      },
      get onTap() {
        return read.current.onTap;
      },
      get onHold() {
        return read.current.onHold;
      },
      get reduced() {
        return read.current.reduced;
      },
      backdrop: () =>
        popup.parentElement?.querySelector<HTMLElement>(
          '[data-slot="dialog-overlay"]',
        ) ?? null,
    });
    gesture.current = attached;
    return () => {
      attached.dispose();
      gesture.current = null;
    };
  }, [popup]);
  useLayoutEffect(() => {
    if (open) gesture.current?.reset();
  }, [open]);
  return useCallback((node: HTMLElement | null) => {
    setPopup(node);
    const thumb = node && latest.current.origin?.()?.getBoundingClientRect();
    if (!node || !thumb?.width || thumb.bottom < 0 || thumb.top > innerHeight)
      return;
    // Measure the resting box (minus the fallback starting shift), then jump
    // straight to the thumbnail so the opening transition starts from there.
    node.style.transition = 'none';
    const rect = node.getBoundingClientRect();
    const shift = new DOMMatrix(getComputedStyle(node).transform);
    const value = originTransform(
      {
        x: rect.left + rect.width / 2 - shift.m41,
        y: rect.top + rect.height / 2 - shift.m42,
        width: node.offsetWidth,
      },
      thumb,
    );
    if (value) node.style.setProperty('--viewer-origin', value);
    void getComputedStyle(node).transform;
    node.style.transition = '';
  }, []);
}
