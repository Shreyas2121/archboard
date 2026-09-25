import { z } from 'zod';

import { applicationIdSchema } from '../graph/index.js';
import { utcTimestampSchema } from '../http/index.js';
import { DEFAULT_BOARD_PAGE_SIZE, MAX_BOARD_PAGE_SIZE } from '../limits/index.js';

const cursorAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const cursorVersion = '1';
const cursorPayloadPattern = /^1\|([^|]+)\|([^|]+)$/;
const maxCursorCharacters = 256;
const base64BitsPerCharacter = 6;
const bitsPerByte = 8;
const base64Remainder = 4;
const maxByte = 255;
const maxAscii = 127;
const base64Mask = 63;

function decodeCursor(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % base64Remainder === 1) return null;
  let bits = 0;
  let bitCount = 0;
  let decoded = '';
  for (const character of value) {
    bits = (bits << base64BitsPerCharacter) | cursorAlphabet.indexOf(character);
    bitCount += base64BitsPerCharacter;
    if (bitCount >= bitsPerByte) {
      bitCount -= bitsPerByte;
      const byte = (bits >>> bitCount) & maxByte;
      if (byte > maxAscii) return null;
      decoded += String.fromCharCode(byte);
      bits &= (1 << bitCount) - 1;
    }
  }
  return bits === 0 ? decoded : null;
}

function encodeCursor(value: string): string {
  let bits = 0;
  let bitCount = 0;
  let encoded = '';
  for (const character of value) {
    bits = (bits << bitsPerByte) | character.charCodeAt(0);
    bitCount += bitsPerByte;
    while (bitCount >= base64BitsPerCharacter) {
      bitCount -= base64BitsPerCharacter;
      encoded += cursorAlphabet[(bits >>> bitCount) & base64Mask];
      bits &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0)
    encoded += cursorAlphabet[(bits << (base64BitsPerCharacter - bitCount)) & base64Mask];
  return encoded;
}

export const pageCursorSchema = z
  .string()
  .min(1)
  .max(maxCursorCharacters)
  .refine((value) => {
    const decoded = decodeCursor(value);
    const match = decoded?.match(cursorPayloadPattern);
    return (
      match !== null &&
      match !== undefined &&
      utcTimestampSchema.safeParse(match[1]).success &&
      applicationIdSchema.safeParse(match[2]).success &&
      encodeCursor(decoded!) === value
    );
  });

export function encodePageCursor(timestamp: string, id: string): PageCursor {
  utcTimestampSchema.parse(timestamp);
  applicationIdSchema.parse(id);
  return pageCursorSchema.parse(encodeCursor(`${cursorVersion}|${timestamp}|${id}`));
}

export function decodePageCursor(cursor: PageCursor): { timestamp: string; id: string } {
  const decoded = decodeCursor(pageCursorSchema.parse(cursor));
  const match = decoded?.match(cursorPayloadPattern);
  if (!match) throw new Error('Invalid page cursor');
  return { timestamp: match[1]!, id: match[2]! };
}

export const pageLimitQuerySchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_BOARD_PAGE_SIZE))
  .default(DEFAULT_BOARD_PAGE_SIZE);

export type PageCursor = z.infer<typeof pageCursorSchema>;
