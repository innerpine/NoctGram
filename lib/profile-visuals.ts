'use client';
import type { Profile } from './client';
import { readProfileBackground } from './profile-background';
import { coverImage } from './profile-cover';
import { preloadImagePalette } from './use-image-palette';

// Cache only image preparation, never private profile/presence responses.
const images = new Map<string, Promise<void>>();
function preloadImage(url: string) {
  const cached = images.get(url);
  if (cached) return cached;
  const ready = new Promise<void>((resolve) => {
    const image = new Image();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      resolve();
    };
    const timeout = setTimeout(finish, 8000);
    image.onload = () => {
      void image
        .decode()
        .catch(() => {})
        .then(finish);
    };
    image.onerror = finish;
    image.src = url;
  });
  if (images.size >= 64) images.delete(images.keys().next().value!);
  images.set(url, ready);
  return ready;
}

export async function prepareProfileVisuals(person: Profile) {
  const background = readProfileBackground(person.profileBackground);
  const cover = coverImage(person.cover);
  const paletteImage = cover || person.avatar;
  await Promise.all([
    ...[...new Set([cover, person.avatar].filter(Boolean))].map(preloadImage),
    person.premium && background.mode === 'cover' && paletteImage
      ? preloadImagePalette(paletteImage)
      : undefined,
  ]);
}
