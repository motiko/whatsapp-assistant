import { describe, expect, test } from 'vitest';
import { createDebugLog, maskId, readDebugLog } from './debug-log';
import { createMemoryArea } from './store';

describe('the debug log', () => {
  test('masks the phone numbers in WhatsApp message ids', () => {
    expect(maskId('true_491512345678@c.us_3EB0C4F1A2')).toBe('true_…@c.us_…F1A2');
    expect(maskId('false_120300000000000001@g.us_ABCDEF_491512345678@c.us')).not.toMatch(/\d{6}/);
  });

  test('keeps both sides’ entries, merged in time order', async () => {
    const area = createMemoryArea();
    let now = 0;
    const whatsapp = createDebugLog(area, 'whatsapp', () => now++);
    const bot = createDebugLog(area, 'bot', () => now++);

    whatsapp('reported');
    bot('report');
    whatsapp('watching');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect((await readDebugLog(area)).map((entry) => `${entry.source} ${entry.event}`)).toEqual([
      'whatsapp reported',
      'bot report',
      'whatsapp watching',
    ]);
  });
});
