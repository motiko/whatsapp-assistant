import { afterEach, describe, expect, test } from 'vitest';
import { createDateRangeFields } from './date-range-fields';

// Wednesday 11 November 2026, mid-afternoon local time.
const today = () => new Date(2026, 10, 11, 15, 30);

afterEach(() => {
  document.body.replaceChildren();
});

function render() {
  const container = document.createElement('div');
  document.body.append(container);
  let changes = 0;
  const fields = createDateRangeFields(container, { today, onChange: () => changes++ });
  const input = (label: string) =>
    Array.from(container.querySelectorAll('label')).find((l) => l.textContent?.startsWith(label))!.querySelector('input')!;
  const button = (name: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === name)!;
  const type = (label: string, value: string) => {
    input(label).value = value;
    input(label).dispatchEvent(new Event('input', { bubbles: true }));
  };
  const error = () => container.querySelector('[role="alert"]')?.textContent ?? '';
  return { fields, input, button, type, error, changes: () => changes };
}

describe('the Date Range fields', () => {
  test('start with To set to today and no From, asking for a From date', () => {
    const { fields, input } = render();

    expect(input('To').value).toBe('2026-11-11');
    expect(input('From').value).toBe('');
    expect(fields.value()).toEqual({ error: 'Choose a From date, or a preset.' });
  });

  test('give the chosen days as a Date Range', () => {
    const { fields, type, error, changes } = render();

    type('From', '2026-11-02');
    type('To', '2026-11-05');

    expect(fields.value()).toEqual({ range: { from: '2026-11-02', to: '2026-11-05' } });
    expect(error()).toBe('');
    expect(changes()).toBe(2);
  });

  test.each([
    ['Today', '2026-11-11', '2026-11-11'],
    ['Last 7 days', '2026-11-05', '2026-11-11'],
    ['Last 30 days', '2026-10-13', '2026-11-11'],
    ['Year to date', '2026-01-01', '2026-11-11'],
    ['Last 2 years', '2024-11-12', '2026-11-11'],
  ])('preset %s picks whole days up to and including today', (preset, from, to) => {
    const { fields, button, type, input } = render();
    type('To', '2026-11-01');

    button(preset).click();

    expect(fields.value()).toEqual({ range: { from, to } });
    expect({ from: input('From').value, to: input('To').value }).toEqual({ from, to });
  });

  test('refuse a From date after the To date', () => {
    const { fields, type, error } = render();

    type('From', '2026-11-06');
    type('To', '2026-11-05');

    expect(fields.value()).toEqual({ error: "From can't be after To." });
    expect(error()).toBe("From can't be after To.");
  });

  test('refuse dates in the future', () => {
    const { fields, type, error } = render();

    type('From', '2026-11-10');
    type('To', '2026-11-12');

    expect(fields.value()).toEqual({ error: "Dates can't be in the future." });
    expect(error()).toBe("Dates can't be in the future.");
  });

  test('preset Full Chat asks for every message, and clears From', () => {
    const { fields, button, type, input, error } = render();
    type('From', '2026-11-12');

    button('Full Chat').click();

    expect(fields.value()).toEqual({ fullChat: true });
    expect(input('From').value).toBe('');
    expect(error()).toBe('');
    expect(button('Full Chat').getAttribute('aria-pressed')).toBe('true');
  });

  test.each([
    ['choosing a From date', (r: ReturnType<typeof render>) => r.type('From', '2026-11-02')],
    ['another preset', (r: ReturnType<typeof render>) => r.button('Last 7 days').click()],
  ])('leave Full Chat for a Date Range on %s', (_, choose) => {
    const fields = render();
    fields.button('Full Chat').click();

    choose(fields);

    expect(fields.fields.value()).toHaveProperty('range');
    expect(fields.button('Full Chat').getAttribute('aria-pressed')).toBe('false');
  });

  test('do not offer future days in the pickers', () => {
    const { input } = render();

    expect(input('From').max).toBe('2026-11-11');
    expect(input('To').max).toBe('2026-11-11');
  });
});
