import { describe, expect, it } from 'vitest';

import { MAX_WS_FRAME_BYTES } from '../limits/index.js';
import { ProtocolFrameError, parseClientFrame, parseServerFrame } from './frames.js';

const encoder = new TextEncoder();
const invalidUtf8 = Buffer.from('wyg=', 'base64');
const tabId = '00000000-0000-4000-8000-000000000001';
const updateId = '00000000-0000-4000-8000-000000000002';

describe('WebSocket frame parsing', () => {
  it('parses a valid client frame without changing its payload', () => {
    const frame = encoder.encode(
      JSON.stringify({
        event: 'hello',
        data: { protocolVersion: 1, schemaVersion: 1, tabId },
      }),
    );

    expect(parseClientFrame(frame)).toEqual({
      event: 'hello',
      data: { protocolVersion: 1, schemaVersion: 1, tabId },
    });
  });

  it.each([
    ['invalid UTF-8', invalidUtf8],
    ['malformed JSON', encoder.encode('{"event":')],
    ['unknown event', encoder.encode('{"event":"presenter.acquire","data":{}}')],
    [
      'unsupported version',
      encoder.encode(
        JSON.stringify({
          event: 'hello',
          data: { protocolVersion: 2, schemaVersion: 1, tabId },
        }),
      ),
    ],
    [
      'extra field',
      encoder.encode(
        JSON.stringify({
          event: 'update',
          data: { updateId, updateBase64: 'AQID', actorId: tabId },
        }),
      ),
    ],
  ])('rejects %s with a safe error', (_name, frame) => {
    expect(() => parseClientFrame(frame)).toThrowError(ProtocolFrameError);
    expect(() => parseClientFrame(frame)).toThrowError('Invalid WebSocket frame.');
  });

  it('rejects a frame above 16 MiB before JSON work', () => {
    const frame = new Uint8Array(MAX_WS_FRAME_BYTES + 1);
    expect(() => parseClientFrame(frame)).toThrowError('WebSocket frame exceeds the size limit.');
  });

  it('rejects invalid server frames independently', () => {
    expect(() =>
      parseServerFrame(encoder.encode('{"event":"ack","data":{"updateId":"bad","seq":1}}')),
    ).toThrowError('Invalid WebSocket frame.');
  });
});
