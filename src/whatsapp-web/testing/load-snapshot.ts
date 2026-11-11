/**
 * Renders a saved WhatsApp Web page snapshot in a real, laid-out frame of the
 * given size, and returns its document.
 */
export async function loadSnapshot(
  html: string,
  viewport = { width: 1280, height: 800 },
): Promise<Document> {
  const frame = document.createElement('iframe');
  frame.style.cssText = `width:${viewport.width}px;height:${viewport.height}px;border:0;display:block`;
  const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  return frame.contentDocument!;
}
