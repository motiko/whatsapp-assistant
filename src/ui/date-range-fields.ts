import type { LocalDay } from '../core/day-span';

export interface DateRange {
  from: LocalDay;
  to: LocalDay;
}

export interface DateRangeFields {
  /** The chosen Date Range, the Full Chat, or why the choice can't be used. */
  value(): { range: DateRange } | { fullChat: true } | { error: string };
  /** Re-reads today (the pickers' upper limit, and To if it is empty). */
  refresh(): void;
}

/**
 * The panel's From and To date pickers with the Today, Last 7 days,
 * Last 30 days and Full Chat presets. Days are whole local days, both ends
 * included, so "Last 7 days" is today and the six days before it. To starts
 * at today; From must not be after To, and neither may be in the future.
 * Full Chat clears From and stands for every message; choosing a date or
 * another preset goes back to a Date Range.
 * Renders into `container`; style it with `dateRangeFieldsStyles`.
 */
export function createDateRangeFields(
  container: HTMLElement,
  options: { today?: () => Date; onChange?: () => void } = {},
): DateRangeFields {
  const today = () => localDay(options.today?.() ?? new Date());
  container.innerHTML = `
    <div class="dates">
      <label>From <input type="date" name="from" required></label>
      <label>To <input type="date" name="to" required></label>
    </div>
    <div class="presets">
      <button type="button" data-days="1">Today</button>
      <button type="button" data-days="7">Last 7 days</button>
      <button type="button" data-days="30">Last 30 days</button>
      <button type="button" class="full-chat" aria-pressed="false">Full Chat</button>
    </div>
    <p class="full-chat-note" hidden>Every message WhatsApp Web can load, from the oldest to the newest.</p>
    <p class="range-error" role="alert"></p>`;
  const fromInput = container.querySelector<HTMLInputElement>('input[name="from"]')!;
  const toInput = container.querySelector<HTMLInputElement>('input[name="to"]')!;
  const errorText = container.querySelector<HTMLElement>('.range-error')!;
  const fullChatButton = container.querySelector<HTMLButtonElement>('.full-chat')!;
  const fullChatNote = container.querySelector<HTMLElement>('.full-chat-note')!;
  let fullChat = false;
  const setFullChat = (on: boolean) => {
    fullChat = on;
    fullChatButton.setAttribute('aria-pressed', String(on));
    fullChatNote.hidden = !on;
  };

  const value = (): ReturnType<DateRangeFields['value']> => {
    if (fullChat) return { fullChat: true };
    const from = fromInput.value;
    const to = toInput.value;
    if (!from) return { error: 'Choose a From date, or a preset.' };
    if (!to) return { error: 'Choose a To date.' };
    if (from > today() || to > today()) return { error: "Dates can't be in the future." };
    if (from > to) return { error: "From can't be after To." };
    return { range: { from, to } };
  };
  const changed = () => {
    // Only shown after a change, so the panel doesn't open with an error.
    const result = value();
    errorText.textContent = 'error' in result ? result.error : '';
    options.onChange?.();
  };
  const refresh = () => {
    fromInput.max = today();
    toInput.max = today();
    if (!toInput.value) toInput.value = today();
  };

  const datePicked = () => {
    setFullChat(false);
    changed();
  };
  fromInput.addEventListener('input', datePicked);
  toInput.addEventListener('input', datePicked);
  fullChatButton.addEventListener('click', () => {
    fromInput.value = '';
    toInput.value = today();
    setFullChat(true);
    changed();
  });
  for (const button of container.querySelectorAll<HTMLButtonElement>('.presets button[data-days]')) {
    button.addEventListener('click', () => {
      setFullChat(false);
      const days = Number(button.dataset.days);
      toInput.value = today();
      fromInput.value = localDay(addDays(options.today?.() ?? new Date(), 1 - days));
      changed();
    });
  }
  refresh();

  return { value, refresh };
}

export const dateRangeFieldsStyles = `
  .dates { display: flex; gap: 8px; }
  .dates label { flex: 1; display: flex; flex-direction: column; gap: 3px; font-size: 12.5px; }
  .dates input { font: inherit; font-size: 13.5px; padding: 5px 6px; border: 1px solid #d1d7db; border-radius: 6px;
    background: inherit; color: inherit; color-scheme: light dark; }
  .presets { display: flex; gap: 6px; margin: 8px 0 4px; flex-wrap: wrap; }
  .presets button { padding: 4px 10px; border: 1px solid #d1d7db; border-radius: 14px; background: transparent;
    color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; }
  .presets button:hover { border-color: #00a884; }
  .presets button[aria-pressed="true"] { border-color: #00a884; background: rgba(0, 168, 132, .12); }
  .full-chat-note { font-size: 12.5px; margin: 4px 0; }
  .full-chat-note[hidden] { display: none; }
  .range-error { color: #c0392b; font-size: 12.5px; }
  .range-error:empty { display: none; }
  :host-context(body.dark) .range-error { color: #f28b82; }
`;

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** A Date as a local day, `YYYY-MM-DD`. */
export function localDay(date: Date): LocalDay {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
