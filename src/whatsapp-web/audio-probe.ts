/**
 * Getting a voice note's audio out of WhatsApp Web.
 *
 * WhatsApp Web decrypts a voice note in the page and plays it from a `blob:`
 * URL. The page's own objects are out of the content script's reach (it runs
 * in an isolated world), so a second, tiny script runs in the page's world
 * (the Audio Probe, `installAudioProbe`): it notes the audio blobs the page
 * makes and the media it plays, can mute and stop what the extension started,
 * and hands a blob over on request. The content script talks to it with
 * `window.postMessage` (the Audio Tap, `createAudioTap`).
 *
 * The probe only ever reads audio the page made; the page could answer in
 * its place, but it is WhatsApp Web itself, which holds that audio anyway.
 * See docs/adr/0006-voice-notes.md.
 */

const channel = 'wa-assistant-audio';
/** Audio blobs kept for handing over (the newest; older ones are let go). */
const keptBlobs = 12;
/** How long after `arm` plays are muted and stopped. */
const armedMs = 20_000;

type Request =
  | { kind: 'arm'; id: number }
  | { kind: 'disarm'; id: number }
  | { kind: 'fetch'; id: number; url: string }
  | { kind: 'state'; id: number };

/** What the probe has seen, by URL scheme and counts only: for the voice-note diagnosis. */
export interface ProbeState {
  /** Audio blobs the page made: their type, size, and when (ms since the page's start). */
  audioBlobs: { type: string; size: number; at: number }[];
  /** Media elements given a source: the source's scheme, and whether the element is in the page. */
  mediaSources: { scheme: string; inPage: boolean; at: number }[];
  plays: number;
  decodeAudioData: number;
  now: number;
}

/** Runs in the page's world (a MAIN-world content script), from document start. */
export function installAudioProbe(win: Window & typeof globalThis): void {
  const marker = '__waAssistantAudioProbe';
  if ((win as unknown as Record<string, unknown>)[marker]) return;
  (win as unknown as Record<string, unknown>)[marker] = true;

  const blobs: { url: string; blob: Blob; at: number }[] = [];
  const state: ProbeState = { audioBlobs: [], mediaSources: [], plays: 0, decodeAudioData: 0, now: 0 };
  /** Media the extension started (played while armed), to stop again. */
  const started = new Set<HTMLMediaElement>();
  let armedUntil = 0;
  const now = () => win.performance.now();
  const note = <T>(list: T[], entry: T) => {
    list.push(entry);
    if (list.length > 30) list.shift();
  };

  const createObjectURL = win.URL.createObjectURL.bind(win.URL);
  win.URL.createObjectURL = (object: Blob | MediaSource) => {
    const url = createObjectURL(object);
    if (object instanceof win.Blob && /^audio\//i.test(object.type)) {
      blobs.push({ url, blob: object, at: now() });
      if (blobs.length > keptBlobs) blobs.shift();
      note(state.audioBlobs, { type: object.type, size: object.size, at: Math.round(now()) });
    }
    return url;
  };

  const media = win.HTMLMediaElement.prototype;
  const srcProperty = Object.getOwnPropertyDescriptor(media, 'src');
  if (srcProperty?.set && srcProperty.get) {
    const { get, set } = srcProperty;
    Object.defineProperty(media, 'src', {
      ...srcProperty,
      get,
      set(this: HTMLMediaElement, value: string) {
        note(state.mediaSources, { scheme: String(value).split(':')[0] ?? '', inPage: this.isConnected, at: Math.round(now()) });
        set.call(this, value);
      },
    });
  }
  const play = media.play;
  media.play = function (this: HTMLMediaElement) {
    state.plays++;
    if (now() < armedUntil) {
      // Started for the extension: silent, and stopped once its audio is had.
      started.add(this);
      this.muted = true;
    }
    return play.call(this);
  };
  const decode = win.AudioContext?.prototype.decodeAudioData;
  if (decode) {
    win.AudioContext.prototype.decodeAudioData = function (this: AudioContext, ...args: Parameters<AudioContext['decodeAudioData']>) {
      state.decodeAudioData++;
      return decode.apply(this, args);
    };
  }

  win.addEventListener('message', (event) => {
    const data = event.data as { channel?: string; to?: string; request?: Request } | undefined;
    if (event.origin !== win.origin || data?.channel !== channel || data.to !== 'probe' || !data.request) return;
    const request = data.request;
    const answer = (body: Record<string, unknown>) => win.postMessage({ channel, to: 'tap', id: request.id, ...body }, '*');
    switch (request.kind) {
      case 'arm':
        armedUntil = now() + armedMs;
        answer({ since: now() });
        return;
      case 'disarm':
        armedUntil = 0;
        for (const element of started) {
          element.pause();
          try {
            element.currentTime = 0;
          } catch {
            // not seekable: left where it stopped
          }
          element.muted = false;
        }
        started.clear();
        answer({});
        return;
      case 'state':
        answer({ state: { ...state, now: Math.round(now()) }, blobs: blobs.map(({ url, at }) => ({ url, at })), started: Array.from(started, (e) => e.currentSrc || e.src) });
        return;
      case 'fetch': {
        const kept = blobs.find((entry) => entry.url === request.url)?.blob;
        const blob = kept ? Promise.resolve(kept) : win.fetch(request.url).then((response) => response.blob());
        blob.then(
          (found) => answer({ blob: found }),
          (error: unknown) => answer({ error: String(error) }),
        );
        return;
      }
    }
  });
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** The content script's side: asks the Audio Probe in the page's world. */
export interface AudioTap {
  /** Makes plays from now on muted and stoppable; resolves with the probe's clock, to tell newer audio. */
  arm(): Promise<number>;
  /** Stops (and rewinds, unmutes) what played while armed. */
  disarm(): Promise<void>;
  /** The URL of an audio source the page made or played after `since` (the probe's clock), waiting up to `waitMs`. */
  audioSince(since: number, waitMs: number): Promise<string | undefined>;
  /** The blob behind a `blob:` URL of the page. */
  fetch(url: string): Promise<Blob>;
  /** What the probe saw, for the diagnosis; undefined when there is no probe (it didn't load). */
  state(): Promise<(ProbeState & { started: string[] }) | undefined>;
}

export function createAudioTap(win: Window, options: { answerWaitMs?: number } = {}): AudioTap {
  const answerWaitMs = options.answerWaitMs ?? 2_000;
  let nextId = 1;

  function ask(request: WithoutId<Request>, waitMs = answerWaitMs): Promise<Record<string, unknown> | undefined> {
    const id = nextId++;
    return new Promise((resolve) => {
      const done = (value: Record<string, unknown> | undefined) => {
        win.removeEventListener('message', listen);
        win.clearTimeout(timer);
        resolve(value);
      };
      const listen = (event: MessageEvent) => {
        const data = event.data as { channel?: string; to?: string; id?: number } | undefined;
        if (event.origin === win.origin && data?.channel === channel && data.to === 'tap' && data.id === id) done(data as Record<string, unknown>);
      };
      win.addEventListener('message', listen);
      const timer = win.setTimeout(() => done(undefined), waitMs);
      win.postMessage({ channel, to: 'probe', request: { ...request, id } }, '*');
    });
  }

  async function newest(since: number): Promise<string | undefined> {
    const answer = await ask({ kind: 'state' });
    const blobs = (answer?.blobs as { url: string; at: number }[] | undefined) ?? [];
    const started = (answer?.started as string[] | undefined) ?? [];
    return blobs.filter((blob) => blob.at >= since).at(-1)?.url ?? started.find((url) => url.startsWith('blob:'));
  }

  return {
    async arm() {
      const answer = await ask({ kind: 'arm' });
      if (typeof answer?.since !== 'number') throw new Error('the Audio Probe in WhatsApp Web did not answer; reload WhatsApp Web');
      return answer.since;
    },
    async disarm() {
      await ask({ kind: 'disarm' });
    },
    async audioSince(since, waitMs) {
      const until = Date.now() + waitMs;
      for (;;) {
        const url = await newest(since);
        if (url || Date.now() >= until) return url;
        // Poll the probe: its blobs are not in the page's DOM, so no MutationObserver sees them.
        await new Promise((resolve) => win.setTimeout(resolve, 250));
      }
    },
    async fetch(url) {
      const answer = await ask({ kind: 'fetch', url }, 15_000);
      const blob = answer?.blob;
      if (blob && typeof (blob as Blob).arrayBuffer === 'function') return blob as Blob;
      throw new Error(`could not read the voice note's audio${answer?.error ? ` (${String(answer.error)})` : ''}`);
    },
    async state() {
      const answer = await ask({ kind: 'state' });
      if (!answer?.state) return undefined;
      return { ...(answer.state as ProbeState), started: ((answer.started as string[] | undefined) ?? []).map((url) => url.split(':')[0] ?? '') };
    },
  };
}
