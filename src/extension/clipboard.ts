/**
 * Puts a PNG on the clipboard. Call it synchronously from the click that
 * asked for it, even though the PNG is still being made: Chrome only allows
 * clipboard writes close to a user gesture, and a ClipboardItem accepts a
 * promise for its data.
 */
export function copyPngToClipboard(png: Promise<Blob>): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}
