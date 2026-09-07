// Decode in the browser so the static avatar is also available without motion.
export async function avatarPoster(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  const video = file.type.startsWith('video/')
    ? document.createElement('video')
    : null;
  const image = video ? null : new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error('Не удалось прочитать аватар. Попробуй другой файл.'),
          ),
        15000,
      );
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('Этот файл не удаётся воспроизвести в браузере.'));
      };
      if (video) {
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.onloadeddata = done;
        video.onerror = fail;
        video.src = url;
        video.load();
      } else {
        image!.onload = done;
        image!.onerror = fail;
        image!.src = url;
      }
    });
    const width = video?.videoWidth || image?.naturalWidth || 0,
      height = video?.videoHeight || image?.naturalHeight || 0;
    if (!width || !height) throw new Error('В файле нет изображения');
    const side = Math.min(width, height),
      canvas = document.createElement('canvas');
    canvas.width = canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось создать превью');
    ctx.drawImage(
      video || image!,
      (width - side) / 2,
      (height - side) / 2,
      side,
      side,
      0,
      0,
      480,
      480,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error('Не удалось создать превью')),
        'image/png',
      ),
    );
    return new File([blob], 'avatar-preview.png', { type: 'image/png' });
  } finally {
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    if (image) image.src = '';
    URL.revokeObjectURL(url);
  }
}
