'use client';
/* eslint-disable next/no-img-element */
import { useRef, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useViewerGesture } from './use-viewer-gesture';

// The tapped thumbnail shows the same URL; prefer one that is on screen.
const thumbnail = (src: string) =>
  [...document.images].find((image) => {
    const rect = image.getBoundingClientRect();
    return (
      image.getAttribute('src') === src &&
      !image.closest('[role="dialog"]') &&
      rect.width > 0 &&
      rect.bottom > 0 &&
      rect.top < innerHeight
    );
  }) ?? null;

/** Photo dialog that grows from its thumbnail, drags down to close and zooms. */
export function PhotoViewer({
  open,
  onOpenChange,
  onOpenChangeComplete,
  src,
  alt,
  title,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  src: string;
  alt: string;
  title: string;
  className: string;
  children?: ReactNode;
}) {
  const image = useRef<HTMLImageElement>(null);
  const popup = useViewerGesture({
    open,
    origin: () => (src ? thumbnail(src) : null),
    accepts: (target) => !target.closest('a,button'),
    dismiss: { share: 0.25, speed: 500 },
    onDismiss: () => onOpenChange(false),
    zoom: () => image.current,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <DialogContent ref={popup} className={'photo-viewer ' + className}>
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {src && <img ref={image} src={src} alt={alt} draggable={false} />}
        {children}
      </DialogContent>
    </Dialog>
  );
}
