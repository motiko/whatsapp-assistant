import type { Camera } from '../camera';
import type { WhatsAppPage } from '../whatsapp-page';
import type { FakeWhatsAppPage } from './fake-whatsapp-page';

/**
 * A Camera that "captures" a generated screen in which every pixel encodes
 * where it came from, so a test can tell exactly which part of the screen
 * (or of the Chat) ended up where in a Chat Record (see `readScreenPositions`).
 *
 * Outside the chat area a pixel encodes its own screen position in device
 * pixels. When a `page` is given, a pixel inside its chat area encodes its
 * screen x and its position in the scrolled message list instead:
 * y = the content position (in device pixels) shown there at the moment of
 * capture (for a fake WhatsApp Page, the Chat position, which stays put when
 * WhatsApp Web shifts the message list). Stitched captures of a scrolled Chat
 * therefore read back as one continuous run of rows.
 *
 * Encoding: R = x & 0xff, G = y & 0xff, B = (x >> 8) << 4 | (y >> 8).
 * Positions are exact up to 4095 device pixels in each direction.
 */
export function createFakeCamera(options: {
  viewport: { width: number; height: number };
  devicePixelRatio?: number;
  /**
   * The page on screen; its chat area shows the message list at its current
   * scroll position (at its `chatPositionShown`, for a fake WhatsApp Page).
   */
  page?: WhatsAppPage | FakeWhatsAppPage;
  /** Every capture rejects with this error (after `failsAfter` successful captures, if given). */
  fails?: Error;
  failsAfter?: number;
}): Camera {
  const devicePixelRatio = options.devicePixelRatio ?? 1;
  let captures = 0;
  return {
    async capture() {
      captures += 1;
      if (options.fails && captures > (options.failsAfter ?? 0)) throw options.fails;
      const width = Math.round(options.viewport.width * devicePixelRatio);
      const height = Math.round(options.viewport.height * devicePixelRatio);
      const area = options.page?.chatArea();
      const page = options.page;
      const scrollTop = page ? ('chatPositionShown' in page ? page.chatPositionShown() : page.scrollTop()) : 0;
      const inArea = (x: number, y: number) =>
        area !== undefined &&
        x >= area.left * devicePixelRatio &&
        x < (area.left + area.width) * devicePixelRatio &&
        y >= area.top * devicePixelRatio &&
        y < (area.top + area.height) * devicePixelRatio;
      const pixels = new ImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const shownY = inArea(x, y) ? Math.round((scrollTop - area!.top) * devicePixelRatio) + y : y;
          const i = (y * width + x) * 4;
          pixels.data[i] = x & 0xff;
          pixels.data[i + 1] = shownY & 0xff;
          pixels.data[i + 2] = ((x >> 8) << 4) | ((shownY >> 8) & 0x0f);
          pixels.data[i + 3] = 255;
        }
      }
      const bitmap = await createImageBitmap(pixels);
      return { bitmap, devicePixelRatio };
    },
  };
}

/**
 * Decodes an image made from a fake Camera screen back into what each pixel
 * shows: its screen position, or (inside a page's chat area) its screen x
 * and content position in the message list.
 */
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
    /** The device-pixel position the pixel at (x, y) was captured from. */
    at(x: number, y: number) {
      const i = (y * bitmap.width + x) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      return { x: ((b >> 4) << 8) | r, y: ((b & 0x0f) << 8) | g };
    },
    /** How many distinct colours the given rectangle of the image has. */
    colourCount(left: number, top: number, width: number, height: number) {
      const colours = new Set<number>();
      for (let y = top; y < top + height; y++) {
        for (let x = left; x < left + width; x++) {
          const i = (y * bitmap.width + x) * 4;
          colours.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
        }
      }
      return colours.size;
    },
  };
}
