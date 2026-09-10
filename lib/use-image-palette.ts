'use client';
/* Colour sampling is asynchronous and keyed by image URL. */
/* eslint-disable react/react-compiler */
import { useEffect, useState } from 'react';
import { paletteFromPixels, type ImagePalette } from './image-palette';
const cache = new Map<string, Promise<ImagePalette | null>>();
const resolved = new Map<string, ImagePalette | null>();
export function preloadImagePalette(url: string) {
  let pending = cache.get(url);
  if (pending) return pending;
  pending = new Promise<ImagePalette | null>((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (value: ImagePalette | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      if (cache.has(url)) resolved.set(url, value);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 8000);
    try {
      if (new URL(url, window.location.href).origin !== window.location.origin)
        img.crossOrigin = 'anonymous';
    } catch {
      finish(null);
      return;
    }
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          finish(null);
          return;
        }
        context.drawImage(img, 0, 0, 24, 24);
        finish(paletteFromPixels(context.getImageData(0, 0, 24, 24).data));
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
  if (cache.size >= 64) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
    resolved.delete(oldest);
  }
  cache.set(url, pending);
  return pending;
}
export function useImagePalette(url: string) {
  const [value, setValue] = useState<{
    url: string;
    colors: ImagePalette | null;
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    void preloadImagePalette(url).then((colors) => {
      if (active) setValue({ url, colors });
    });
    return () => {
      active = false;
    };
  }, [url]);
  return url
    ? value?.url === url
      ? value.colors
      : resolved.get(url) || null
    : null;
}
