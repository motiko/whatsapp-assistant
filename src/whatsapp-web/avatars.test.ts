import { afterEach, describe, expect, test } from 'vitest';
import { setAvatarsHidden } from './avatars';
import { loadSnapshot } from './testing/load-snapshot';
import groupChat from './fixtures/group-chat.html?raw';

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

/** The group Chat snapshot, with images blocked so a profile photo URL is never fetched. */
const withoutImageRequests = groupChat.replace(
  '<head>',
  `<head><meta http-equiv="Content-Security-Policy" content="img-src 'none'">`,
);

/** Adds the avatars WhatsApp Web shows: a profile photo and a placeholder, in the Chat list and the Chat header. */
function addAvatars(doc: Document) {
  const photo = doc.createElement('img');
  photo.src = 'https://pps.whatsapp.net/v/t61.24694-24/avatar.jpg';
  doc.querySelector('#pane-side [role="row"]')!.prepend(photo);
  const placeholder = doc.createElement('span');
  placeholder.dataset.icon = 'default-group-refreshed';
  doc.querySelector('#main header')!.prepend(placeholder);
  return [photo, placeholder];
}

const visibility = (element: Element) => element.ownerDocument.defaultView!.getComputedStyle(element).visibility;

describe('hiding avatars', () => {
  test('hides profile photos and placeholder avatars, keeping their space', async () => {
    const doc = await loadSnapshot(withoutImageRequests);
    const avatars = addAvatars(doc);
    const widths = avatars.map((avatar) => avatar.getBoundingClientRect().width);

    setAvatarsHidden(doc, true);

    expect(avatars.map(visibility)).toEqual(['hidden', 'hidden']);
    expect(avatars.map((avatar) => avatar.getBoundingClientRect().width)).toEqual(widths);
  });

  test('also hides avatars WhatsApp Web adds afterwards', async () => {
    const doc = await loadSnapshot(withoutImageRequests);
    setAvatarsHidden(doc, true);

    const avatars = addAvatars(doc);

    expect(avatars.map(visibility)).toEqual(['hidden', 'hidden']);
  });

  test('leaves message text and other icons alone', async () => {
    const doc = await loadSnapshot(withoutImageRequests);

    setAvatarsHidden(doc, true);

    expect(visibility(doc.querySelector('[data-pre-plain-text]')!)).toBe('visible');
    expect(visibility(doc.querySelector('[data-icon="search"]')!)).toBe('visible');
  });

  test('shows them again when turned off, however often it was turned on', async () => {
    const doc = await loadSnapshot(withoutImageRequests);
    const avatars = addAvatars(doc);

    setAvatarsHidden(doc, true);
    setAvatarsHidden(doc, true);
    setAvatarsHidden(doc, false);

    expect(avatars.map(visibility)).toEqual(['visible', 'visible']);
  });
});
