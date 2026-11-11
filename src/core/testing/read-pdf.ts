import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { readScreenPositions } from './fake-camera';

/**
 * Reads a Chat Record PDF back into its pages, in order. Each page is the one
 * image drawn on it, decoded like `readScreenPositions`, so a test can tell
 * which screen positions ended up on which page. Also gives each page's size
 * in PDF points.
 *
 * Only understands PDFs whose pages each show one lossless (Flate-compressed
 * RGB) image, which is what the Chat Recorder makes.
 */
export async function readPdfPages(pdf: Blob) {
  const document = await PDFDocument.load(await pdf.arrayBuffer());
  return Promise.all(
    document.getPages().map(async (page) => {
      const xObjects = page.node.Resources()?.lookup(PDFName.of('XObject'), PDFDict);
      const images = xObjects?.entries().map(([, ref]) => document.context.lookup(ref)) ?? [];
      const image = images[0];
      if (images.length !== 1 || !(image instanceof PDFRawStream)) throw new Error('expected one image on the page');
      const number = (key: string) => image.dict.lookup(PDFName.of(key), PDFNumber).asNumber();
      const width = number('Width');
      const height = number('Height');
      if (image.dict.get(PDFName.of('Filter'))?.toString() !== '/FlateDecode') throw new Error('expected a lossless image');
      const rgb = new Uint8Array(
        await new Response(new Blob([image.contents as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer(),
      );
      const rgba = new ImageData(width, height);
      for (let i = 0; i < width * height; i++) {
        rgba.data.set(rgb.subarray(i * 3, i * 3 + 3), i * 4);
        rgba.data[i * 4 + 3] = 255;
      }
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')!.putImageData(rgba, 0, 0);
      const pixels = await readScreenPositions(await canvas.convertToBlob({ type: 'image/png' }));
      const { width: points, height: pointsHigh } = page.getSize();
      return { ...pixels, size: { width: points, height: pointsHigh } };
    }),
  );
}
