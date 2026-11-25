/**
 * Gives a saved (static) snapshot the parts of WhatsApp Web's behaviour that
 * auto-translation relies on, a moment after each action (as WhatsApp Web
 * re-renders):
 *
 * - clicking a Chat list row opens that Chat (its name goes in the header);
 * - typing a name into the search box that matches one of `searchable`
 *   shows a row for it in the Chat list, and emptying the box removes it;
 * - clicking the send button moves the message box's text into a new
 *   outgoing message at the bottom of the message list;
 * - with `voice`, pressing a voice note's play button makes its audio (a
 *   blob holding `voice`'s text) and plays it in an `Audio` outside the page,
 *   as WhatsApp Web is guessed to do (unverified).
 *
 * With a real snapshot, check what WhatsApp Web really does on each.
 */
export function emulateChats(
  doc: Document,
  options: { searchable?: string[]; modern?: boolean; delayedEditor?: boolean; voice?: string } = {},
): void {
  const view = doc.defaultView!;
  const later = (work: () => void) => view.setTimeout(work, 10);
  let sent = 0;

  // WhatsApp Web's message box is an editor (Lexical) that takes over typing: it cancels the
  // browser's own editing and applies the change itself a moment later.
  if (options.delayedEditor) {
    const box = doc.querySelector<HTMLElement>('#main footer [contenteditable]')!;
    box.addEventListener('beforeinput', (event) => {
      event.preventDefault();
      const paragraph = box.querySelector('p')!;
      later(() => {
        if (event.inputType === 'insertText') {
          paragraph.querySelector('br:only-child')?.remove();
          paragraph.append(event.data ?? '');
        } else if (event.inputType === 'insertLineBreak') {
          paragraph.append(doc.createElement('br'));
        } else if (event.inputType.startsWith('delete')) {
          paragraph.innerHTML = '<br>';
        }
      });
    });
  }

  /** Moves the message box's text into a new outgoing message, as WhatsApp Web does on send. */
  const send = () => {
    const box = doc.querySelector<HTMLElement>('#main footer [contenteditable]')!;
    const text = box.innerText.trim();
    if (!text) return;
    later(() => {
      box.innerHTML = '<p class="selectable-text copyable-text"><br></p>';
      const item = doc.createElement('div');
      item.setAttribute('role', 'row');
      const id = options.modern ? `3EB0SENT${String(++sent).padStart(4, '0')}` : `true_491500000001@c.us_SENT${++sent}`;
      item.innerHTML = options.modern
        ? `<div data-id="${id}"><div class="focusable-list-item"><div class="wrap end"><div class="bubble"><div class="copyable-text" data-pre-plain-text="[10:20, 11/11/2026] Me: "><span class="selectable-text copyable-text"></span></div></div></div></div></div>`
        : `<div class="message-out" data-id="${id}"><div class="_amk6"><div class="copyable-text" data-pre-plain-text="[10:20, 11/11/2026] Me: "><span class="selectable-text copyable-text"></span></div></div></div>`;
      item.querySelector('.selectable-text')!.textContent = text;
      doc.querySelector('#main ._list')!.append(item);
    });
  };
  // Newer pages have no send icon while the box is empty: Enter sends.
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && (event.target as Element).closest('#main footer [contenteditable]')) send();
  });

  doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    const row = target.closest('#pane-side [role="listitem"]') ?? target.closest('#pane-side [role="row"]');
    if (row) {
      const name = row.querySelector('span[title]')!.getAttribute('title')!;
      later(() => {
        doc.querySelector('#main header span[dir="auto"]')!.textContent = name;
      });
      return;
    }
    if (options.voice !== undefined && target.closest('#main [data-id] button[aria-label*="play" i]')) {
      const voice = options.voice;
      later(() => {
        const url = view.URL.createObjectURL(new view.Blob([voice], { type: 'audio/ogg; codecs=opus' }));
        const audio = new view.Audio();
        audio.src = url;
        audio.play().catch(() => {}); // not real audio: it never plays
      });
      return;
    }
    if (target.closest('#main footer button')) send();
  });

  const search = doc.querySelector<HTMLElement>('#side [contenteditable]');
  search?.addEventListener('input', () => {
    const query = search.innerText.trim();
    later(() => {
      doc.querySelectorAll('[data-search-result]').forEach((result) => result.remove());
      const match = options.searchable?.find((name) => query !== '' && name === query);
      if (!match) return;
      const item = doc.createElement('div');
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-search-result', '');
      item.innerHTML = '<div role="row"><span dir="auto"></span></div>';
      const title = item.querySelector('span')!;
      title.setAttribute('title', match);
      title.textContent = match;
      doc.querySelector('#pane-side [role="grid"]')!.prepend(item);
    });
  });
}
