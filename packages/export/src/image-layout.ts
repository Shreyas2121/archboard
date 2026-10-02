import { MAX_EXPORT_IMAGE_PIXELS, MAX_EXPORT_IMAGE_SIDE_PIXELS } from '@archboard/contracts';

export const IMAGE_PADDING = 24;
export const STROKE_MARGIN = 8;
export const TEXT_CELL_WIDTH = 8;
export const TEXT_LINE_HEIGHT = 18;
export const TEXT_FONT_SIZE = 12;
export const CARD_INSET = 12;
export const CARD_HEADER_HEIGHT = 54;
export const IMAGE_HALF = 2;
export const IMAGE_SCALE_DOUBLE = 2;
export type ImageScale = 1 | typeof IMAGE_SCALE_DOUBLE;
export const CORNER_RADIUS = 8;
export const IMAGE_STROKE_WIDTH = 2;
export const DASH_LENGTH = 6;
export const MARKER_SIZE = 8;
export const LABEL_LINE_LIMIT = 2;
export const LABEL_WIDTH_LIMIT = 320;
export const XML_REPLACEMENT = '\ufffd';
const XML_TAB = 9;
const XML_LF = 10;
const XML_CR = 13;
const XML_PRINTABLE_START = 32;
const XML_SURROGATE_START = 0xd800;
const XML_SURROGATE_END = 0xdfff;
const XML_VALID_BMP_END = 0xfffd;
const XML_SUPPLEMENTARY_START = 0x10000;

/** XML 1.0-invalid controls/lone surrogates become U+FFFD for display; JSON is unchanged. */
export function escapeXml(source: string): string {
  let output = '';
  for (const character of source) {
    const code = character.codePointAt(0)!;
    const valid =
      code === XML_TAB ||
      code === XML_LF ||
      code === XML_CR ||
      (code >= XML_PRINTABLE_START &&
        code <= XML_VALID_BMP_END &&
        !(code >= XML_SURROGATE_START && code <= XML_SURROGATE_END)) ||
      code >= XML_SUPPLEMENTARY_START;
    const safe = valid ? character : XML_REPLACEMENT;
    output +=
      safe === '&'
        ? '&amp;'
        : safe === '<'
          ? '&lt;'
          : safe === '>'
            ? '&gt;'
            : safe === '"'
              ? '&quot;'
              : safe === "'"
                ? '&apos;'
                : safe;
  }
  return output;
}

/** Scan only the visible character/line budget; hidden long bodies are never fully laid out. */
export function layoutImageText(
  source: string,
  width: number,
  maxLines: number,
): { lines: string[]; overflow: boolean } {
  const columns = Math.max(1, Math.floor(width / TEXT_CELL_WIDTH));
  const scanBudget = Math.max(1, maxLines) * (columns + 1);
  const lines: string[] = [];
  let line = '';
  let count = 0;
  let consumed = 0;
  let scanned = 0;
  for (const character of source) {
    if (lines.length >= maxLines || scanned++ >= scanBudget) break;
    if (character === '\r') {
      consumed += character.length;
      continue;
    }
    if (character !== '\n' && count >= columns) {
      lines.push(line);
      line = '';
      count = 0;
      if (lines.length >= maxLines) break;
    }
    consumed += character.length;
    if (character === '\n') {
      lines.push(line);
      line = '';
      count = 0;
      continue;
    }
    line += character === '\t' ? ' ' : character;
    count++;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return { lines, overflow: consumed < source.length };
}

export function imageDimensions(width: number, height: number, scale: ImageScale = 1) {
  if (
    (scale !== 1 && scale !== IMAGE_SCALE_DOUBLE) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error('Image dimensions must be finite and positive; choose 1× or 2× scale.');
  const pixelsWide = Math.ceil(width * scale);
  const pixelsHigh = Math.ceil(height * scale);
  if (
    pixelsWide > MAX_EXPORT_IMAGE_SIDE_PIXELS ||
    pixelsHigh > MAX_EXPORT_IMAGE_SIDE_PIXELS ||
    pixelsWide * pixelsHigh > MAX_EXPORT_IMAGE_PIXELS
  )
    throw new Error(
      'Image exceeds 8,192 pixels per side or 32 megapixels. Reduce scope or PNG scale; nothing was cropped or shrunk.',
    );
  return Object.freeze({ width: pixelsWide, height: pixelsHigh });
}

export function imageFileName(title: string, format: 'svg' | 'png'): string {
  if (format !== 'svg' && format !== 'png') throw new Error('Choose SVG or PNG.');
  const MAX_FILENAME_CHARACTERS = 80;
  const safe = title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_FILENAME_CHARACTERS);
  return `archboard-${safe || 'diagram'}.${format}`;
}
