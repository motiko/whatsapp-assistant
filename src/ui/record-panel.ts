import type { FailureReason } from '../core/chat-recorder';
import type { LocalDay } from '../core/day-span';
import { createDateRangeFields, dateRangeFieldsStyles, type DateRange } from './date-range-fields';

/** A Chat Record ready to save: its PNG or PDF and the file name (`.png` or `.pdf`) to save it under. */
export interface RecordFile {
  name: string;
  image: Blob;
}

/** What became of a click on Create Chat Record. */
export type CreateResult =
  | {
      kind: 'made';
      file: RecordFile;
      /** Whether the Chat Record reached the clipboard, and why not if it didn't. */
      clipboard: { copied: true } | { copied: false; detail: string };
    }
  /** A Chat Record too long for one image: a PDF, which the panel downloads straight away. */
  | { kind: 'made-pdf'; file: RecordFile }
  /** The chosen Date Range has no messages; nothing was made. */
  | { kind: 'no-messages'; from: LocalDay; to: LocalDay }
  | { kind: 'failed'; reason: FailureReason | 'busy'; detail: string };

export interface RecordPanel {
  /** The header button; place it with `keepInChatHeader`. */
  button: HTMLElement;
  open(): void;
  /** Hides all of the extension's UI until the returned function is called. */
  hide(): () => void;
}

/**
 * The header button and the small panel it opens. The panel shows which Chat
 * the Chat Record will be of, the Date Range fields, a Create Chat Record
 * button, and the result.
 */
export function createRecordPanel(
  doc: Document,
  options: {
    /** The open Chat's name, or undefined if it cannot be read. */
    chatName: () => string | undefined;
    /** Must start any clipboard write synchronously (see `copyPngToClipboard`). */
    createChatRecord: (range: DateRange) => Promise<CreateResult>;
    /** Saves the file to the Downloads folder; throws if it can't. */
    download: (file: RecordFile) => void;
  },
): RecordPanel {
  const buttonHost = doc.createElement('whatsapp-assistant-button');
  const buttonRoot = buttonHost.attachShadow({ mode: 'open' });
  buttonRoot.innerHTML = `<style>${buttonStyles}</style>
    <button type="button" title="Create a Chat Record" aria-label="Create a Chat Record" aria-haspopup="dialog">${icon}</button>`;
  const headerButton = buttonRoot.querySelector('button')!;

  const panelHost = doc.createElement('whatsapp-assistant-panel');
  const panelRoot = panelHost.attachShadow({ mode: 'open' });
  panelRoot.innerHTML = `<style>${panelStyles}${dateRangeFieldsStyles}</style>
    <section role="dialog" aria-labelledby="title" hidden>
      <header><h2 id="title">Chat Record</h2><button type="button" class="close" aria-label="Close">×</button></header>
      <p class="chat">Chat: <strong></strong></p>
      <div class="range"></div>
      <p class="hint">Copies the messages of these days to the clipboard as an image, with a band above them naming the Chat, the days and when it was taken. More than about ten screens of messages download as a PDF instead. Keep this tab visible and leave it alone until it's done.</p>
      <button type="button" class="create">Create Chat Record</button>
      <p class="status" role="status" aria-live="polite"></p>
      <button type="button" class="download" hidden>Download PNG</button>
    </section>`;
  const dialog = panelRoot.querySelector('section')!;
  const chatLabel = panelRoot.querySelector('.chat strong')!;
  const createButton = panelRoot.querySelector<HTMLButtonElement>('.create')!;
  const status = panelRoot.querySelector<HTMLElement>('.status')!;
  const downloadButton = panelRoot.querySelector<HTMLButtonElement>('.download')!;
  let busy = false;
  const updateCreateButton = () => {
    createButton.disabled = busy || 'error' in dateRange.value();
  };
  const dateRange = createDateRangeFields(panelRoot.querySelector<HTMLElement>('.range')!, {
    onChange: updateCreateButton,
  });
  doc.body.append(panelHost);

  /** The Chat Record last made, kept in memory only while the panel offers to download it. */
  let lastRecord: RecordFile | undefined;
  const offerDownload = (file: RecordFile | undefined) => {
    lastRecord = file;
    downloadButton.hidden = file === undefined;
    downloadButton.textContent = file?.name.endsWith('.pdf') ? 'Download PDF' : 'Download PNG';
  };

  const open = () => {
    if (!panelHost.isConnected) doc.body.append(panelHost);
    chatLabel.textContent = options.chatName() ?? 'unknown';
    status.textContent = '';
    status.className = 'status';
    offerDownload(undefined);
    dateRange.refresh();
    updateCreateButton();
    dialog.hidden = false;
    position();
    panelRoot.querySelector<HTMLInputElement>('input')!.focus();
  };
  const close = () => {
    dialog.hidden = true;
  };
  const position = () => {
    const anchor = buttonHost.isConnected ? buttonHost.getBoundingClientRect() : undefined;
    const top = anchor ? anchor.bottom + 6 : 64;
    const right = anchor ? Math.max(doc.documentElement.clientWidth - anchor.right, 8) : 16;
    dialog.style.top = `${top}px`;
    dialog.style.right = `${right}px`;
  };
  const show = (text: string, tone: 'working' | 'done' | 'error') => {
    status.textContent = text;
    status.className = `status ${tone}`;
  };

  headerButton.addEventListener('click', () => (dialog.hidden ? open() : close()));
  panelRoot.querySelector('.close')!.addEventListener('click', close);
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !dialog.hidden) close();
  });
  doc.addEventListener('pointerdown', (event) => {
    const path = event.composedPath();
    if (!dialog.hidden && !path.includes(panelHost) && !path.includes(buttonHost)) close();
  });

  createButton.addEventListener('click', () => {
    const chosen = dateRange.value();
    if (!('range' in chosen)) return;
    busy = true;
    updateCreateButton();
    offerDownload(undefined);
    show('Making the Chat Record…', 'working');
    options
      .createChatRecord(chosen.range)
      .then((result) => {
        if (result.kind === 'failed') {
          show(failureMessage(result.reason, result.detail), 'error');
          return;
        }
        if (result.kind === 'no-messages') {
          show(noMessagesText(result.from, result.to), 'error');
          return;
        }
        if (result.kind === 'made-pdf') {
          downloadPdf(result.file);
          return;
        }
        offerDownload(result.file);
        if (result.clipboard.copied) show('Chat Record copied to the clipboard as a PNG.', 'done');
        else show(`The Chat Record couldn't be copied to the clipboard (${result.clipboard.detail}). You can download it instead.`, 'error');
      })
      .finally(() => {
        busy = false;
        updateCreateButton();
      });
  });

  const download = (file: RecordFile, done: string) => {
    try {
      options.download(file);
      show(done, 'done');
      return true;
    } catch (error) {
      show(`The Chat Record couldn't be downloaded (${error instanceof Error ? error.message : String(error)}).`, 'error');
      return false;
    }
  };
  /** A PDF is never copied; it is downloaded as soon as it is made (or offered again if that fails). */
  const downloadPdf = (file: RecordFile) => {
    const done = `The Chat Record is more than about ten screens long, so it was downloaded as a PDF to your Downloads folder as “${file.name}”.`;
    offerDownload(download(file, done) ? undefined : file);
  };

  downloadButton.addEventListener('click', () => {
    if (!lastRecord) return;
    download(lastRecord, `Chat Record downloaded to your Downloads folder as “${lastRecord.name}”.`);
  });

  return {
    button: buttonHost,
    open,
    hide() {
      buttonHost.style.visibility = 'hidden';
      panelHost.style.visibility = 'hidden';
      return () => {
        buttonHost.style.visibility = '';
        panelHost.style.visibility = '';
      };
    },
  };
}

function noMessagesText(from: LocalDay, to: LocalDay): string {
  const format = (day: LocalDay) => {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year!, month! - 1, date).toLocaleDateString(undefined, { dateStyle: 'medium' });
  };
  return from === to
    ? `No messages on ${format(from)}. Nothing was copied.`
    : `No messages between ${format(from)} and ${format(to)}. Nothing was copied.`;
}

function failureMessage(reason: Extract<CreateResult, { kind: 'failed' }>['reason'], detail: string): string {
  switch (reason) {
    case 'page-not-recognised':
      return "WhatsApp Web's page wasn't recognised, so no Chat Record was made. The extension probably needs an update for a WhatsApp change.";
    case 'capture-not-allowed':
      return "Chrome hasn't allowed this extension to capture this tab yet. Click the WhatsApp Assistant icon in Chrome's toolbar once, then try again.";
    case 'capture-failed':
      return `The screen couldn't be captured (${detail}). Nothing was copied.`;
    case 'busy':
      return 'A Chat Record is already being made. Wait for it to finish.';
  }
}

const icon = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>`;

const buttonStyles = `
  :host { display: inline-flex; margin-right: 10px; }
  button { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
    border: 0; border-radius: 50%; background: transparent; color: #54656f; cursor: pointer; padding: 0; }
  :host-context(body.dark) button { color: #aebac1; }
  button:hover { background: rgba(11, 20, 26, .08); }
  :host-context(body.dark) button:hover { background: rgba(255, 255, 255, .1); }
  button:focus-visible { outline: 2px solid #00a884; outline-offset: 2px; }
`;

const panelStyles = `
  section { position: fixed; z-index: 2147483647; width: 320px; box-sizing: border-box; padding: 14px 16px 16px;
    background: #fff; color: #111b21; border-radius: 10px; box-shadow: 0 6px 24px rgba(11, 20, 26, .25);
    font: 14px/1.4 "Segoe UI", Helvetica, Arial, sans-serif; }
  :host-context(body.dark) section { background: #233138; color: #e9edef; }
  section[hidden] { display: none; }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close { border: 0; background: none; color: inherit; font-size: 20px; line-height: 1; cursor: pointer; padding: 2px 6px; }
  p { margin: 8px 0; }
  .chat strong { overflow-wrap: anywhere; }
  .hint { font-size: 12.5px; opacity: .75; }
  .create { width: 100%; margin-top: 4px; padding: 9px 12px; border: 0; border-radius: 20px;
    background: #00a884; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .create:disabled { opacity: .6; cursor: progress; }
  .download { width: 100%; padding: 8px 12px; border: 1px solid #00a884; border-radius: 20px;
    background: transparent; color: #008069; font: inherit; font-weight: 600; cursor: pointer; }
  :host-context(body.dark) .download { color: #25d366; }
  .download[hidden] { display: none; }
  .status:empty { display: none; }
  .status.error { color: #c0392b; }
  :host-context(body.dark) .status.error { color: #f28b82; }
  .status.done { color: #008069; }
  :host-context(body.dark) .status.done { color: #25d366; }
`;
