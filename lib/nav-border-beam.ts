type BeamPixel = { index: number; distance: number; coverage: number };

// Paint the gradient in perimeter coordinates. Moving a rectangular gradient
// around the outline leaves its visible edge stationary while turning corners.
export function createBorderBeam(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  scale: number,
  stars: boolean,
) {
  const context = canvas.getContext('2d');
  if (!context || width < 2 || height < 2) return null;
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const left = 0.5,
    top = 0.5,
    right = width - 0.5,
    bottom = height - 0.5;
  const radius = Math.min(13.5, (width - 1) / 2, (height - 1) / 2);
  const horizontal = right - left - radius * 2;
  const vertical = bottom - top - radius * 2;
  const arc = (Math.PI * radius) / 2;
  const perimeter = 2 * horizontal + 2 * vertical + 4 * arc;
  const length = Math.min(width <= 44 ? 40 : 64, perimeter / 2);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.beginPath();
  context.roundRect(left, top, right - left, bottom - top, radius);
  context.lineWidth = 1;
  context.strokeStyle = '#fff';
  context.stroke();
  context.setTransform(1, 0, 0, 1, 0, 0);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const pixels: BeamPixel[] = [];
  for (let index = 0; index < frame.data.length; index += 4) {
    const coverage = frame.data[index + 3];
    if (!coverage) continue;
    const pixel = index / 4;
    const x = ((pixel % canvas.width) + 0.5) / scale;
    const y = (Math.floor(pixel / canvas.width) + 0.5) / scale;
    let distance: number;
    if (x > right - radius && y < top + radius) {
      distance =
        horizontal +
        radius *
          (Math.atan2(y - top - radius, x - right + radius) + Math.PI / 2);
    } else if (x > right - radius && y > bottom - radius) {
      distance =
        horizontal +
        vertical +
        arc +
        radius * Math.atan2(y - bottom + radius, x - right + radius);
    } else if (x < left + radius && y > bottom - radius) {
      distance =
        2 * horizontal +
        vertical +
        2 * arc +
        radius *
          (Math.atan2(y - bottom + radius, x - left - radius) - Math.PI / 2);
    } else if (x < left + radius && y < top + radius) {
      const angle =
        Math.atan2(y - top - radius, x - left - radius) + 2 * Math.PI;
      distance =
        2 * horizontal + 2 * vertical + 3 * arc + radius * (angle - Math.PI);
    } else if (y < top + radius) {
      distance = x - left - radius;
    } else if (x > right - radius) {
      distance = horizontal + arc + y - top - radius;
    } else if (y > bottom - radius) {
      distance = horizontal + vertical + 2 * arc + right - radius - x;
    } else {
      distance = 2 * horizontal + vertical + 3 * arc + bottom - radius - y;
    }
    pixels.push({ index, distance, coverage });
  }
  // The same three stops as the original CSS gradient, with a smooth fade.
  const middle = stars ? [255, 168, 68] : [56, 189, 248];
  const headColor = stars ? [255, 218, 85] : [167, 139, 250];
  const gradient = new Uint8ClampedArray(256 * 4);
  for (let step = 0; step < 256; step++) {
    const mix = Math.max(0, (step / 255) * 2 - 1);
    for (let color = 0; color < 3; color++) {
      gradient[step * 4 + color] =
        middle[color] + (headColor[color] - middle[color]) * mix;
    }
    gradient[step * 4 + 3] = Math.min(255, step * 2);
  }
  return (time: number) => {
    const head = ((time % 8000) / 8000) * perimeter;
    for (const { index, distance, coverage } of pixels) {
      const behind = (head - distance + perimeter) % perimeter;
      if (behind >= length) {
        frame.data[index + 3] = 0;
        continue;
      }
      const stop = Math.round((1 - behind / length) * 255) * 4;
      frame.data[index] = gradient[stop];
      frame.data[index + 1] = gradient[stop + 1];
      frame.data[index + 2] = gradient[stop + 2];
      frame.data[index + 3] =
        ((coverage * gradient[stop + 3]) / 255) * Math.min(1, behind * scale);
    }
    context.putImageData(frame, 0, 0);
  };
}
