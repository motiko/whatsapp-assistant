import { describe, expect, test } from 'vitest';
import { maxForwardedAtOnce, newIncomingMessages, type LoadedMessage } from './new-messages';

const incoming = (id: string): LoadedMessage => ({ id, direction: 'in', text: id });
const outgoing = (id: string): LoadedMessage => ({ id, direction: 'out', text: id });

describe('which loaded messages are new', () => {
  test('incoming messages after the last seen one are new', () => {
    const loaded = [incoming('a'), incoming('b'), incoming('c')];

    expect(newIncomingMessages(loaded, new Set(['a']))).toEqual([incoming('b'), incoming('c')]);
  });

  test('nothing is new when the newest message was seen', () => {
    expect(newIncomingMessages([incoming('a'), incoming('b')], new Set(['b']))).toEqual([]);
  });

  test('incoming messages before the user’s own reply count as answered, even if never seen', () => {
    const loaded = [incoming('a'), outgoing('me'), incoming('b')];

    expect(newIncomingMessages(loaded, new Set())).toEqual([incoming('b')]);
  });

  test('older, unseen history loaded above seen messages is not new', () => {
    const loaded = [incoming('old1'), incoming('old2'), incoming('seen'), incoming('new')];

    expect(newIncomingMessages(loaded, new Set(['seen']))).toEqual([incoming('new')]);
  });

  test('the user’s own messages are never new', () => {
    expect(newIncomingMessages([incoming('a'), outgoing('b')], new Set(['a']))).toEqual([]);
  });

  test(`at most ${maxForwardedAtOnce} messages, the newest`, () => {
    const loaded = Array.from({ length: 30 }, (_, n) => incoming(`m${n}`));

    const fresh = newIncomingMessages(loaded, new Set());

    expect(fresh).toHaveLength(maxForwardedAtOnce);
    expect(fresh.at(-1)).toEqual(incoming('m29'));
    expect(fresh[0]).toEqual(incoming('m10'));
  });
});

describe('which loaded messages are new, in test mode (own messages too)', () => {
  const includeOwn = { includeOwn: true };

  test('the user\u2019s own unseen messages are new', () => {
    const loaded = [outgoing('seen'), outgoing('mine'), incoming('theirs')];

    expect(newIncomingMessages(loaded, new Set(['seen']), includeOwn)).toEqual([outgoing('mine'), incoming('theirs')]);
  });

  test('messages the extension sent are never new', () => {
    const loaded = [outgoing('seen'), { ...outgoing('from-telegram'), sentHere: true }, outgoing('typed')];

    expect(newIncomingMessages(loaded, new Set(['seen']), includeOwn)).toEqual([outgoing('typed')]);
  });

  test('a seen message in between is skipped, not forwarded again', () => {
    const loaded = [outgoing('a'), outgoing('b'), outgoing('c')];

    expect(newIncomingMessages(loaded, new Set(['a', 'c']), includeOwn)).toEqual([]);
  });
});
