import { estimateCount, formatCost, type Capability, type ModelChoice, typicalMessage, typicalVoiceSeconds } from '../../core/translation/providers';

/**
 * A dialog listing a provider's models in a table to search and sort (by
 * name, estimated cost, context, or date added); clicking a row picks it.
 */
type Column = 'name' | 'cost' | 'context' | 'created';

export function openModelBrowser(options: {
  capability: Capability;
  models: readonly ModelChoice[];
  current: string;
  onPick(id: string): void;
}): void {
  const { capability, models, current } = options;
  const hasCost = models.some((model) => model.cost !== undefined);
  const hasContext = capability === 'chat' && models.some((model) => model.context !== undefined);
  const hasCreated = models.some((model) => model.created !== undefined);
  const columns: { key: Column; title: string }[] = [
    { key: 'name', title: 'Model' },
    ...(hasCost ? [{ key: 'cost' as const, title: `Cost / ${estimateCount}` }] : []),
    ...(hasContext ? [{ key: 'context' as const, title: 'Context' }] : []),
    ...(hasCreated ? [{ key: 'created' as const, title: 'Added' }] : []),
  ];
  let sortBy: Column = hasCost ? 'cost' : 'name';
  let ascending = true;

  const dialog = document.createElement('dialog');
  dialog.className = 'model-browser';
  const header = document.createElement('div');
  header.className = 'browser-head';
  const title = document.createElement('h2');
  title.textContent = capability === 'chat' ? 'Translation models' : 'Speech-to-text models';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'link';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => dialog.close());
  header.append(title, closeButton);
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = `Search ${models.length} models`;
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = hasCost
    ? capability === 'chat'
      ? `Cost: an estimate for translating ${estimateCount} messages (about ${typicalMessage.inputTokens} tokens in and ${typicalMessage.outputTokens} out each), at the provider's list prices.`
      : `Cost: an estimate for transcribing ${estimateCount} voice notes of ${typicalVoiceSeconds} seconds each, at the provider's list prices.`
    : 'This provider doesn’t list prices; see its website for them.';
  const scroller = document.createElement('div');
  scroller.className = 'browser-table';
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const body = document.createElement('tbody');
  table.append(head, body);
  scroller.append(table);
  dialog.append(header, search, hint, scroller);

  function value(model: ModelChoice, column: Column): string | number | undefined {
    return column === 'name' ? (model.name ?? model.id).toLowerCase() : model[column];
  }

  function render() {
    const headRow = document.createElement('tr');
    for (const column of columns) {
      const cell = document.createElement('th');
      cell.className = column.key;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link';
      button.textContent = column.title + (sortBy === column.key ? (ascending ? ' ▲' : ' ▼') : '');
      button.addEventListener('click', () => {
        // Newest first and cheapest first are the useful first clicks.
        if (sortBy === column.key) ascending = !ascending;
        else ascending = column.key !== 'created' && column.key !== 'context';
        sortBy = column.key;
        render();
      });
      cell.setAttribute('aria-sort', sortBy === column.key ? (ascending ? 'ascending' : 'descending') : 'none');
      cell.append(button);
      headRow.append(cell);
    }
    head.replaceChildren(headRow);

    const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = models
      .filter((model) => {
        const text = `${model.name ?? ''} ${model.id}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => {
        const x = value(a, sortBy);
        const y = value(b, sortBy);
        // Unknown values last, whichever way it is sorted.
        if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
        const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
        return ascending ? order : -order;
      });
    body.replaceChildren(
      ...shown.map((model) => {
        const row = document.createElement('tr');
        if (model.id === current) row.className = 'current';
        row.tabIndex = 0;
        const name = document.createElement('td');
        name.className = 'name';
        const label = document.createElement('span');
        label.className = 'combo-label';
        label.textContent = model.name ?? model.id;
        name.append(label);
        if (model.name) {
          const id = document.createElement('span');
          id.className = 'combo-value';
          id.textContent = model.id;
          name.append(id);
        }
        row.append(name);
        for (const column of columns.slice(1)) {
          const cell = document.createElement('td');
          cell.className = column.key;
          const raw = model[column.key as Exclude<Column, 'name'>];
          cell.textContent =
            raw === undefined
              ? '–'
              : column.key === 'cost'
                ? formatCost(raw)
                : column.key === 'context'
                  ? `${Math.round(raw / 1000).toLocaleString()}k`
                  : new Date(raw * 1000).toISOString().slice(0, 10);
          row.append(cell);
        }
        const pick = () => {
          options.onPick(model.id);
          dialog.close();
        };
        row.addEventListener('click', pick);
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') pick();
        });
        return row;
      }),
    );
    if (shown.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = columns.length;
      cell.className = 'hint';
      cell.textContent = 'No model matches.';
      row.append(cell);
      body.append(row);
    }
  }

  search.addEventListener('input', render);
  dialog.addEventListener('close', () => dialog.remove());
  // A click on the backdrop (outside the dialog's box) closes it.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  render();
  document.body.append(dialog);
  dialog.showModal();
  search.focus();
}
