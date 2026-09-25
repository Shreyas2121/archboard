import type { z } from 'zod';

import { MAX_WS_FRAME_BYTES } from '../limits/index.js';
import { clientMessageSchema, serverMessageSchema } from './schemas.js';

export class ProtocolFrameError extends Error {
  constructor(readonly code: 'PAYLOAD_TOO_LARGE' | 'VALIDATION_ERROR') {
    super(
      code === 'PAYLOAD_TOO_LARGE'
        ? 'WebSocket frame exceeds the size limit.'
        : 'Invalid WebSocket frame.',
    );
    this.name = 'ProtocolFrameError';
  }
}

function parseFrame<T extends z.ZodType>(bytes: Uint8Array, schema: T): z.output<T> {
  if (bytes.byteLength > MAX_WS_FRAME_BYTES) {
    throw new ProtocolFrameError('PAYLOAD_TOO_LARGE');
  }

  let value: unknown;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(json) as unknown;
  } catch {
    throw new ProtocolFrameError('VALIDATION_ERROR');
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProtocolFrameError('VALIDATION_ERROR');
  }
  return result.data;
}

export function parseClientFrame(bytes: Uint8Array) {
  return parseFrame(bytes, clientMessageSchema);
}

export function parseServerFrame(bytes: Uint8Array) {
  return parseFrame(bytes, serverMessageSchema);
}
