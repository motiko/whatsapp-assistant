import type { Camera } from '../camera';

/**
 * A Camera that "captures" a generated screen in which every pixel encodes
 * its own position in device pixels, so a test can tell exactly which part of
 * the screen ended up where in a Chat Record (see `readScreenPositions`).
 *
 * Encoding: R = x & 0xff, G = y & 0xff, B = (x >> 8) << 4 | (y >> 8).
 * Positions are exact up to 4095 device pixels in each direction.
 */
export function createFakeCamera(options: {
  viewport: { width: number; height: number };
  devicePixelRatio?: number;
  fails?: Error;
}): Camera {
  const devicePixelRatio = options.devicePixelRatio ?? 1;
  return {
    async capture() {
      if (options.fails) throw options.fails;
      const width = Math.round(options.viewport.width * devicePixelRatio);
      const height = Math.round(options.viewport.height * devicePixelRatio);
      const pixels = new ImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          pixels.data[i] = x & 0xff;
          pixels.data[i + 1] = y & 0xff;
          pixels.data[i + 2] = ((x >> 8) << 4) | (y >> 8);
          pixels.data[i + 3] = 255;
        }
      }
      const bitmap = await createImageBitmap(pixels);
      return { bitmap, devicePixelRatio };
    },
  };
}

/** Decodes an image made from a fake Camera screen back into screen positions. */
export async function readScreenPositions(image: Blob) {
  const bitmap = await createImageBitmap(image, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return {
    width: bitmap.width,
    height: bitmap.height,
    /** The device-pixel screen position the pixel at (x, y) was captured from. */
    at(x: number, y: number) {
      const i = (y * bitmap.width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      return { x: ((b >> 4) << 8) | r, y: ((b & 0x0f) << 8) | g };
    },
  };
}
