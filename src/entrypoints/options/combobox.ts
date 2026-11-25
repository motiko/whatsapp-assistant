/**
 * A text field with a searchable list of suggestions below it: typing filters
 * them (every word must appear in the value or its label), arrow keys and
 * Enter or a click pick one. Any other text can still be typed. A pick sets
 * the field and fires `change`, as typing would.
 */
export interface ComboOption {
  value: string;
  /** Shown above the value, and searched too (a provider's or model's name). */
  label?: string;
  /** Shown at the right, not searched (a model's price). */
  detail?: string;
}

/** At most this many suggestions are shown at once; typing narrows them. */
const shownAtOnce = 60;
let comboCount = 0;

export function combobox(input: HTMLInputElement): { setOptions(options: ComboOption[]): void } {
  let options: ComboOption[] = [];
  let shown: ComboOption[] = [];
  let active = -1;
  /** Until the user types, all suggestions show (not only those matching the current value). */
  let typed = false;

  const id = `combo-${++comboCount}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'combo';
  input.replaceWith(wrapper);
  const list = document.createElement('ul');
  list.className = 'combo-list';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrapper.append(input, list);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');
  input.autocomplete = 'off';

  function matching(): ComboOption[] {
    const words = typed ? input.value.toLowerCase().split(/\s+/).filter(Boolean) : [];
    if (words.length === 0) return options;
    const hits = options.filter((option) => {
      const text = `${option.label ?? ''} ${option.value}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    // Those starting with what was typed first, then the rest, each in list order.
    const first = words[0]!;
    const starts = (option: ComboOption) =>
      option.value.toLowerCase().includes(`/${first}`) ||
      option.value.toLowerCase().startsWith(first) ||
      (option.label ?? '').toLowerCase().startsWith(first);
    return [...hits.filter(starts), ...hits.filter((option) => !starts(option))];
  }

  function open() {
    shown = matching();
    active = -1;
    if (shown.length === 0) return close();
    const items = shown.slice(0, shownAtOnce).map((option, index) => {
      const item = document.createElement('li');
      item.id = `${id}-${index}`;
      item.setAttribute('role', 'option');
      if (option.label) {
        const label = document.createElement('span');
        label.className = 'combo-label';
        label.textContent = option.label;
        item.append(label);
      }
      const value = document.createElement('span');
      value.className = 'combo-value';
      value.textContent = option.value;
      item.append(value);
      if (option.detail) {
        const detail = document.createElement('span');
        detail.className = 'combo-detail';
        detail.textContent = option.detail;
        item.append(detail);
      }
      // mousedown, not click: picks before the field loses focus and closes the list.
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(option);
      });
      return item;
    });
    if (shown.length > shownAtOnce) {
      const more = document.createElement('li');
      more.className = 'combo-more';
      more.textContent = `${shown.length - shownAtOnce} more: type to narrow them down`;
      items.push(more);
    }
    list.replaceChildren(...items);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    list.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function highlight(index: number) {
    const count = Math.min(shown.length, shownAtOnce);
    if (count === 0) return;
    active = (index + count) % count;
    list.querySelectorAll('[role="option"]').forEach((item, i) => item.classList.toggle('active', i === active));
    const item = list.querySelector<HTMLElement>(`#${id}-${active}`);
    item?.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', `${id}-${active}`);
  }

  function pick(option: ComboOption) {
    input.value = option.value;
    close();
    typed = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('focus', () => {
    typed = false;
    open();
  });
  input.addEventListener('click', () => {
    if (list.hidden) open();
  });
  input.addEventListener('input', () => {
    typed = true;
    open();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) open();
      highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      pick(shown[active]!);
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    }
  });

  return {
    setOptions(next) {
      options = next;
      if (document.activeElement === input) open();
    },
  };
}
