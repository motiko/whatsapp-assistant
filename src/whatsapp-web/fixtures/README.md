# WhatsApp Web page snapshots

The WhatsApp Web adapter tests (`../whatsapp-web-page.test.ts`, `../chat-header.test.ts`)
load these HTML files into a real, 1280x800 browser frame and check what the adapter reads.

## These snapshots are SYNTHETIC

Every file here was **written by hand** to resemble WhatsApp Web's page structure as
best we know it (`#app`, the `#side` Chat list, the `#main` conversation pane with its
`header`, the scrolling message list with `role="application"` and `role="row"` items,
date divider chips, `data-pre-plain-text` messages, and the `footer` message box).
None of them is a saved copy of the real page, and the real page may differ.
Passing tests therefore prove the adapter matches these files, **not** that it matches
today's WhatsApp Web. Replace them with real snapshots as soon as possible.

| File | Represents |
| --- | --- |
| `one-to-one-chat.html` | An open one-to-one Chat, light theme |
| `group-chat.html` | An open group Chat (sender names on incoming messages), light theme |
| `unrelated-page.html` | A page that is not WhatsApp Web's Chat view |

Each snapshot embeds a small `<style>` block that fixes the layout the tests assert
(nav rail 64px, Chat list 400px, Chat header 59px, message box 62px, 6px scrollbar).
A real snapshot will carry WhatsApp's own stylesheet instead; update the expected
numbers in the tests to match the real layout at 1280x800.

## Replacing a snapshot with a real, scrubbed one

1. Open WhatsApp Web in Chrome, open a Chat, and resize the window so the page is
   1280x800 (DevTools device toolbar: Responsive, 1280 x 800, zoom 100%).
2. In DevTools, Elements panel, right-click the `<html>` element, **Copy > Copy outerHTML**,
   and paste it into a new file here.
3. Keep layout working offline: WhatsApp's CSS is in external `<link rel="stylesheet">`
   files. Either inline what the Chat view needs into a `<style>` block, or (simpler)
   keep only the Chat-view structure and a small `<style>` like the synthetic files.
   Remove every `<script>` element.
4. **Scrub personal content before committing.** Replace, at least:
   - Chat names, contact names and phone numbers (header, Chat list, sender names,
     `title`/`aria-label` attributes, `data-pre-plain-text`);
   - message text, link previews, captions, and `data-id` values (they contain phone
     numbers, e.g. `false_4915112345678@c.us_...`);
   - every `img`/`src`/`srcset`/`style="background-image"` (profile photos, media
     thumbnails): point them at nothing or a blank data URL.
   Search the file for digits runs (`[0-9]{6,}`) and `@c.us` / `@g.us` before committing.
5. Put a comment at the top saying it is a real, scrubbed snapshot and the date taken.
6. Run `npm test`. If the adapter fails, fix the selectors in `../selectors.ts`
   (and, if needed, `../whatsapp-web-page.ts`), not the tests' expectations about
   behaviour; only the layout numbers should change with a new snapshot.
