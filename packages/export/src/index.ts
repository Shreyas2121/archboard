import {
  exportEnvelopeSchema,
  MAX_IMPORT_FILE_BYTES,
  type ExportEnvelope,
} from '@archboard/contracts';

const MAX_JSON_DEPTH = 32;
const JSON_INDENT_SPACES = 2;

export class PortableFileError extends Error {
  public constructor(
    public readonly reason: 'size' | 'encoding' | 'json' | 'structure',
    message: string,
  ) {
    super(message);
  }
}

export interface ExportDurability {
  online: boolean;
  authoritative: boolean;
  persistencePending: boolean;
  outboxPending: boolean;
  acknowledged: boolean;
}

/** Capture is synchronous; no awaits, writes, outbox draining, or partial image scope. */
export function capturePortableEnvelope(
  capture: Omit<ExportEnvelope, 'format' | 'formatVersion' | 'syncStatusAtExport'>,
  durability: ExportDurability,
): ExportEnvelope {
  return exportEnvelopeSchema.parse({
    ...capture,
    format: 'archboard',
    formatVersion: 1,
    syncStatusAtExport:
      durability.online &&
      durability.authoritative &&
      durability.acknowledged &&
      !durability.persistencePending &&
      !durability.outboxPending
        ? 'server-saved'
        : 'local-only',
  });
}

/** Byte and nesting limits precede JSON.parse, including for adversarial unknown fields. */
export function parsePortableJson(input: Uint8Array | string): ExportEnvelope {
  return exportEnvelopeSchema.parse(parseBoundedJson(input, MAX_IMPORT_FILE_BYTES));
}

/** Also used before the server's JSON body parser with bounded request overhead. */
export function parseBoundedJson(input: Uint8Array | string, maxBytes: number): unknown {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > maxBytes) throw new PortableFileError('size', 'File exceeds 5 MiB.');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new PortableFileError('encoding', 'File must be valid UTF-8.');
  }
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const character of source) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{' || character === '[') {
      if (++depth > MAX_JSON_DEPTH)
        throw new PortableFileError('structure', 'File nesting is too deep.');
    } else if (character === '}' || character === ']') depth--;
  }
  let value: unknown;
  try {
    value = JSON.parse(source, (key: string, item: unknown) => {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe key.');
      return item;
    });
  } catch {
    throw new PortableFileError('json', 'File contains invalid JSON or prohibited keys.');
  }
  return value;
}

/** The caller captures projection, metadata and durable ACK coverage synchronously together. */
export function serializePortableJson(capture: ExportEnvelope): {
  json: string;
  byteLength: number;
  reimportable: boolean;
} {
  const json = JSON.stringify(exportEnvelopeSchema.parse(capture), null, JSON_INDENT_SPACES);
  const byteLength = new TextEncoder().encode(json).byteLength;
  return { json, byteLength, reimportable: byteLength <= MAX_IMPORT_FILE_BYTES };
}
