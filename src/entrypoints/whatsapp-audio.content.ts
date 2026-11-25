import { installAudioProbe } from '../whatsapp-web/audio-probe';

/**
 * The Audio Probe, in WhatsApp Web's own world (not the isolated one of the
 * other content script): it sees the voice notes' audio the page makes. From
 * document start, before the page makes any. See `audio-probe.ts`.
 */
export default defineContentScript({
  matches: ['https://web.whatsapp.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installAudioProbe(window);
  },
});
