/**
 * Gives a saved (static) snapshot WhatsApp Web's "Read more" behaviour: a
 * click on "Read more" shows the rest of the message a moment later (as
 * WhatsApp Web re-renders after the click). The rest is `extraLines` more
 * lines of text, and "Read more" goes away.
 */
export function emulateReadMore(doc: Document, extraLines: number): void {
  doc.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('.read-more-button');
    if (!button) return;
    const text = button.parentElement!;
    doc.defaultView!.setTimeout(() => {
      button.remove();
      for (let line = 0; line < extraLines; line++) {
        const span = doc.createElement('span');
        span.textContent = 'Placeholder rest of a long message.';
        text.append(span);
      }
    }, 10);
  });
}
