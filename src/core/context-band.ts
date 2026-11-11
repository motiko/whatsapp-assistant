import { formatDaySpan, localDayOf, type DaySpan } from './day-span';

/**
 * The Context Band: the strip added above a Chat Record stating the Chat's
 * name, the date span covered and when the Chat Record was taken. It is drawn
 * as a separate strip and never over the WhatsApp pixels (ADR-0002).
 */
export interface ContextBandContent {
  chatName: string;
  /** The days the Chat Record actually covers. */
  span: DaySpan;
  takenAt: Date;
  /**
   * Further lines shown under the standard ones, for example when history
   * was incomplete: "Requested from 2024-01-01; earliest available 2025-03-14".
   */
  notes?: string[];
}

/** The Context Band's text, one entry per line, in the order drawn. */
export function contextBandText(content: ContextBandContent): string[] {
  return [
    `Chat: ${content.chatName}`,
    `Messages: ${formatDaySpan(content.span)}`,
    `Taken: ${formatTakenAt(content.takenAt)}`,
    ...(content.notes ?? []),
  ];
}

/**
 * A new image of `image` with the Context Band's `text` drawn in a strip above
 * it. The image's own pixels are copied unchanged below the strip; the result
 * is as wide as the image. `scale` is the image's device pixel ratio, so the
 * band's text has the same size on screen as WhatsApp's.
 */
export function withContextBand(
  image: ImageBitmap | OffscreenCanvas,
  text: string[],
  scale: number,
): OffscreenCanvas {
  const band = drawContextBand(text, image.width, scale);
  const canvas = new OffscreenCanvas(image.width, band.height + image.height);
  const context = canvas.getContext('2d')!;
  context.drawImage(band, 0, 0);
  context.drawImage(image, 0, band.height);
  return canvas;
}

/**
 * The Context Band on its own, `width` device pixels wide (for example to put
 * at the top of a PDF's first page).
 */
export function drawContextBand(text: string[], width: number, scale: number): OffscreenCanvas {
  const padding = Math.round(12 * scale);
  const lineHeight = Math.round(20 * scale);
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!;
  const lines = text.flatMap((line, index) => {
    measure.font = fontFor(index, scale);
    return wrap(measure, line, width - 2 * padding).map((wrapped) => ({ text: wrapped, font: fontFor(index, scale) }));
  });

  const canvas = new OffscreenCanvas(width, 2 * padding + lines.length * lineHeight + Math.round(scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = colours.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = colours.rule;
  context.fillRect(0, canvas.height - Math.round(scale), canvas.width, Math.round(scale));
  context.fillStyle = colours.text;
  context.textBaseline = 'middle';
  lines.forEach((line, index) => {
    context.font = line.font;
    context.fillText(line.text, padding, padding + index * lineHeight + lineHeight / 2);
  });
  return canvas;
}

const colours = { background: '#ffffff', text: '#111b21', rule: '#d1d7db' };

function fontFor(lineIndex: number, scale: number): string {
  const weight = lineIndex === 0 ? '600 ' : '';
  return `${weight}${Math.round(14 * scale)}px "Segoe UI", Helvetica, Arial, sans-serif`;
}

/** Splits `line` into lines no wider than `maxWidth`, at spaces where possible. */
function wrap(context: OffscreenCanvasRenderingContext2D, line: string, maxWidth: number): string[] {
  const graphemes = Array.from(new Intl.Segmenter().segment(line), (segment) => segment.segment);
  const lines: string[] = [];
  let current = '';
  let lastSpace = -1;
  for (const grapheme of graphemes) {
    const candidate = current + grapheme;
    if (current !== '' && context.measureText(candidate).width > maxWidth) {
      if (lastSpace > 0 && grapheme !== ' ') {
        lines.push(current.slice(0, lastSpace));
        current = current.slice(lastSpace + 1) + grapheme;
      } else {
        lines.push(current);
        current = grapheme === ' ' ? '' : grapheme;
      }
      lastSpace = current.lastIndexOf(' ');
      continue;
    }
    current = candidate;
    if (grapheme === ' ') lastSpace = current.length - 1;
  }
  lines.push(current);
  return lines;
}

/** "2026-11-11 14:32 (UTC+01:00)", in the computer's local time. */
function formatTakenAt(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `${localDayOf(date)} ${pad(date.getHours())}:${pad(date.getMinutes())} (UTC${sign}${hours}:${minutes})`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
