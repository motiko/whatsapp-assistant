import type { Camera } from '../core/camera';

/**
 * Wraps the Camera for one Chat Record that needs the WhatsApp tab to stay
 * visible throughout. Once the tab has been hidden (another tab chosen, the
 * window minimised), every later capture fails, and so does one in progress,
 * even if the tab is visible again: WhatsApp Web may have changed under it,
 * and Chrome does not paint a hidden tab. Call `release` when the record ends.
 */
export function whileTabVisible(doc: Document, camera: Camera): { camera: Camera; release: () => void } {
  let wasHidden = doc.visibilityState === 'hidden';
  const onChange = () => {
    if (doc.visibilityState === 'hidden') wasHidden = true;
  };
  doc.addEventListener('visibilitychange', onChange);
  const check = () => {
    if (wasHidden) throw new Error('The WhatsApp tab was hidden while the Chat Record was being made');
  };
  return {
    camera: {
      async capture() {
        check();
        const screenshot = await camera.capture();
        try {
          check();
        } catch (error) {
          screenshot.bitmap.close();
          throw error;
        }
        return screenshot;
      },
    },
    release: () => doc.removeEventListener('visibilitychange', onChange),
  };
}
