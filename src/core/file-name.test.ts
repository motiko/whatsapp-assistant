import { describe, expect, test } from 'vitest';
import { chatRecordFileName } from './file-name';

// The Chat Recorder names every Chat Record with this; recorder tests cover a
// single day, these cover the cases a record of the visible chat can't reach yet.
const oneDay = { from: '2026-11-11', to: '2026-11-11' };

describe('Chat Record file name', () => {
  test('gives both days of a Date Range spanning several days', () => {
    expect(chatRecordFileName('Alice', { from: '2026-10-01', to: '2026-10-31' }, 'png')).toBe(
      'Chat history - Alice - 2026-10-01 to 2026-10-31.png',
    );
  });

  test('gives one date for a single day', () => {
    expect(chatRecordFileName('Alice', oneDay, 'png')).toBe('Chat history - Alice - 2026-11-11.png');
  });

  test('ends in .pdf for a PDF', () => {
    expect(chatRecordFileName('Alice', { from: '2025-03-14', to: '2026-11-11' }, 'pdf')).toBe(
      'Chat history - Alice - 2025-03-14 to 2026-11-11.pdf',
    );
  });

  test('replaces slashes, colons and every other character a file name cannot hold', () => {
    expect(chatRecordFileName('a/b\\c:d*e?f"g<h>i|j', oneDay, 'png')).toBe(
      'Chat history - a_b_c_d_e_f_g_h_i_j - 2026-11-11.png',
    );
  });

  test('keeps emoji, with skin tones, variation selectors and flags', () => {
    expect(chatRecordFileName('Trip 🇩🇪 👍🏽 ❤️ 🎉', oneDay, 'png')).toBe('Chat history - Trip 🇩🇪 👍🏽 ❤️ 🎉 - 2026-11-11.png');
  });

  // Chrome turns invisible format characters, such as the joiner inside 👨‍👩‍👧,
  // into "_" when it saves a download; dropping them keeps the emoji themselves.
  test('splits joined emoji into the emoji they are made of', () => {
    expect(chatRecordFileName('Family 👨‍👩‍👧', oneDay, 'png')).toBe('Chat history - Family 👨👩👧 - 2026-11-11.png');
  });

  test('keeps letters of other scripts', () => {
    expect(chatRecordFileName('Ömer – משפחה', oneDay, 'png')).toBe('Chat history - Ömer – משפחה - 2026-11-11.png');
  });

  test('drops invisible direction marks and turns line breaks into spaces', () => {
    expect(chatRecordFileName('‎Bob‏\nSmith\t‪Jr‬', oneDay, 'png')).toBe(
      'Chat history - Bob Smith Jr - 2026-11-11.png',
    );
  });

  test('does not start the Chat name with a dot or end it with one', () => {
    expect(chatRecordFileName('...hidden...', oneDay, 'png')).toBe('Chat history - hidden - 2026-11-11.png');
  });

  test('still names a Chat whose name has nothing usable', () => {
    expect(chatRecordFileName(' ‎ ', oneDay, 'png')).toBe('Chat history - Unnamed Chat - 2026-11-11.png');
  });

  test('shortens a very long Chat name so the file name fits in 255 bytes, without splitting an emoji', () => {
    const name = chatRecordFileName('👍🏽'.repeat(60), { from: '2026-10-01', to: '2026-10-31' }, 'png');

    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(255);
    expect(name).toMatch(/^Chat history - (👍🏽)+… - 2026-10-01 to 2026-10-31\.png$/u);
  });
});
