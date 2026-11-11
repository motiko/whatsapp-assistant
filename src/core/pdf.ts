import { PDFDocument } from 'pdf-lib';

/** PDF points per CSS pixel (CSS has 96 px to the inch, PDF 72 points). */
const pointsPerCssPixel = 72 / 96;

/**
 * Makes a PDF on this computer (no network) with one page per image, in
 * order. Each page is exactly the size of its image, at the image's size on
 * screen (`devicePixelRatio` device pixels to the CSS pixel), and the image is
 * kept losslessly: every pixel is stored as it was.
 */
export async function pdfOfImages(
  images: AsyncIterable<OffscreenCanvas>,
  options: { devicePixelRatio: number; title: string; createdAt: Date },
): Promise<Blob> {
  const document = await PDFDocument.create();
  document.setTitle(options.title);
  document.setCreator('WhatsApp Assistant');
  document.setCreationDate(options.createdAt);
  document.setModificationDate(options.createdAt);
  const scale = pointsPerCssPixel / options.devicePixelRatio;
  for await (const image of images) {
    const png = await image.convertToBlob({ type: 'image/png' });
    const embedded = await document.embedPng(await png.arrayBuffer());
    // Compress it into the document now, rather than holding every page's raw pixels until the end.
    await embedded.embed();
    const size = { width: image.width * scale, height: image.height * scale };
    document.addPage([size.width, size.height]).drawImage(embedded, { x: 0, y: 0, ...size });
  }
  const bytes = await document.save();
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
}
