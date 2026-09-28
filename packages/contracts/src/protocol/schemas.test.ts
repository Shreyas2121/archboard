import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeSchema } from '../errors/index.js';
import { GRAPH_SCHEMA_VERSION } from '../graph/index.js';
import {
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_DRAG_PREVIEW_POSITIONS,
  MAX_PRESENCE_SELECTION_COUNT,
  MAX_WS_ERROR_MESSAGE_CHARACTERS,
  MAX_WS_FRAME_BYTES,
} from '../limits/index.js';
import {
  CLIENT_EVENT_NAMES,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
  SERVER_SEQUENCE_ZERO,
  clientMessageSchema,
  clientUpdateBase64Schema,
  serverMessageSchema,
  serverSequenceSchema,
  snapshotBase64Schema,
} from './schemas.js';

const UUID_SUFFIX_LENGTH = 12;
const HEXADECIMAL_RADIX = 16;
const TAB_INDEX = 1;
const UPDATE_INDEX = 2;
const CONNECTION_INDEX = 3;
const OBJECT_INDEX = 4;
const POSTGRES_BIGINT_MAX_STRING = '9223372036854775807';
const POSTGRES_BIGINT_OVERFLOW_STRING = '9223372036854775808';

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(HEXADECIMAL_RADIX).padStart(UUID_SUFFIX_LENGTH, '0')}`;
}

const TAB_ID = testUuid(TAB_INDEX);
const UPDATE_ID = testUuid(UPDATE_INDEX);
const CONNECTION_ID = testUuid(CONNECTION_INDEX);
const OBJECT_ID = testUuid(OBJECT_INDEX);
const CANONICAL_UPDATE_BASE64 = 'AQID';

const presence = {
  cursor: { x: 10, y: 20 },
  selectedIds: [OBJECT_ID],
  dragPreview: { positions: [{ id: OBJECT_ID, position: { x: 30, y: 40 } }] },
};

describe('WebSocket protocol contracts', () => {
  it('accepts every Phase 1 client event', () => {
    const messages = [
      {
        event: CLIENT_EVENT_NAMES.HELLO,
        data: {
          protocolVersion: PROTOCOL_VERSION,
          schemaVersion: GRAPH_SCHEMA_VERSION,
          tabId: TAB_ID,
        },
      },
      {
        event: CLIENT_EVENT_NAMES.UPDATE,
        data: { updateId: UPDATE_ID, updateBase64: CANONICAL_UPDATE_BASE64 },
      },
      { event: CLIENT_EVENT_NAMES.PRESENCE, data: presence },
    ];

    for (const message of messages) {
      expect(clientMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it('accepts every Phase 1 server event', () => {
    const messages = [
      {
        event: SERVER_EVENT_NAMES.READY,
        data: {
          role: 'editor',
          latestSeq: SERVER_SEQUENCE_ZERO,
          snapshotBase64: CANONICAL_UPDATE_BASE64,
          connectionId: CONNECTION_ID,
          limits: {
            maxClientUpdateBytes: MAX_CLIENT_UPDATE_BYTES,
            maxEncodedYjsStateBytes: MAX_ENCODED_YJS_STATE_BYTES,
            maxWebSocketFrameBytes: MAX_WS_FRAME_BYTES,
            maxLiveNodes: MAX_LIVE_NODES,
            maxLiveEdges: MAX_LIVE_EDGES,
            maxLiveBoundaries: MAX_LIVE_BOUNDARIES,
            maxLivePresentationSteps: MAX_LIVE_PRESENTATION_STEPS,
            maxPresenceSelectedIds: MAX_PRESENCE_SELECTED_IDS,
          },
        },
      },
      { event: SERVER_EVENT_NAMES.ACK, data: { updateId: UPDATE_ID, seq: '1' } },
      {
        event: SERVER_EVENT_NAMES.UPDATE,
        data: { updateBase64: CANONICAL_UPDATE_BASE64, seq: '2' },
      },
      {
        event: SERVER_EVENT_NAMES.PRESENCE,
        data: {
          connectionId: CONNECTION_ID,
          user: { id: 'better-auth-user-id', name: 'Ada', color: 'violet' },
          presence,
          expiresAt: '2026-09-13T06:30:00.000Z',
        },
      },
      {
        event: SERVER_EVENT_NAMES.ERROR,
        data: {
          code: ERROR_CODES.PERSISTENCE_FAILED,
          message: 'Commit failed.',
          retryable: true,
          updateId: UPDATE_ID,
        },
      },
      {
        event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
        data: { role: null, archived: false },
      },
      {
        event: SERVER_EVENT_NAMES.INVALIDATE,
        data: { resource: 'comments' },
      },
    ];

    for (const message of messages) {
      expect(serverMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it.each([
    ['unknown event', { event: 'unknown', data: {} }],
    [
      'unknown envelope field',
      {
        event: CLIENT_EVENT_NAMES.HELLO,
        data: { protocolVersion: 1, schemaVersion: 1, tabId: TAB_ID },
        extra: true,
      },
    ],
    [
      'unknown data field',
      {
        event: CLIENT_EVENT_NAMES.UPDATE,
        data: { updateId: UPDATE_ID, updateBase64: CANONICAL_UPDATE_BASE64, actorId: TAB_ID },
      },
    ],
    [
      'invalid UUID',
      {
        event: CLIENT_EVENT_NAMES.UPDATE,
        data: { updateId: 'update-1', updateBase64: CANONICAL_UPDATE_BASE64 },
      },
    ],
  ])('rejects %s', (_caseName, message) => {
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });

  it.each(['AQI', 'AQ-_', 'ZE==', 'Zm9='])('rejects non-canonical base64: %s', (value) => {
    expect(clientUpdateBase64Schema.safeParse(value).success).toBe(false);
  });

  it('rejects decoded update bytes over the shared limit', () => {
    const oversizedUpdate = Buffer.alloc(MAX_CLIENT_UPDATE_BYTES + 1).toString('base64');

    expect(clientUpdateBase64Schema.safeParse(oversizedUpdate).success).toBe(false);
    expect(
      clientUpdateBase64Schema.safeParse(Buffer.alloc(MAX_CLIENT_UPDATE_BYTES).toString('base64'))
        .success,
    ).toBe(true);
    expect(clientUpdateBase64Schema.safeParse('').success).toBe(false);
  });

  it('rejects an oversized snapshot without running unbounded lexical validation', () => {
    const oversizedSnapshot = Buffer.alloc(MAX_ENCODED_YJS_STATE_BYTES + 1).toString('base64');

    expect(snapshotBase64Schema.safeParse(oversizedSnapshot).success).toBe(false);
  });

  it.each(['-1', '+1', '01', '1.0', POSTGRES_BIGINT_OVERFLOW_STRING])(
    'rejects a non-canonical or out-of-range PostgreSQL sequence: %s',
    (sequence) => {
      expect(serverSequenceSchema.safeParse(sequence).success).toBe(false);
    },
  );

  it('accepts the complete non-negative PostgreSQL bigint range as strings', () => {
    expect(serverSequenceSchema.parse(SERVER_SEQUENCE_ZERO)).toBe(SERVER_SEQUENCE_ZERO);
    expect(serverSequenceSchema.parse(POSTGRES_BIGINT_MAX_STRING)).toBe(POSTGRES_BIGINT_MAX_STRING);
  });

  it('rejects unknown canonical error codes', () => {
    expect(errorCodeSchema.safeParse('DATABASE_WENT_AWAY').success).toBe(false);
  });

  it('rejects presence selections beyond their shared bound', () => {
    const selectedIds = Array.from({ length: MAX_PRESENCE_SELECTED_IDS + 1 }, (_unused, index) =>
      testUuid(index + 1),
    );
    const message = {
      event: CLIENT_EVENT_NAMES.PRESENCE,
      data: { ...presence, selectedIds },
    };

    expect(clientMessageSchema.safeParse(message).success).toBe(false);
  });

  it('accepts a bounded selection count for truncated presence and rejects bad counts', () => {
    const valid = {
      event: CLIENT_EVENT_NAMES.PRESENCE,
      data: { ...presence, selectedCount: MAX_PRESENCE_SELECTION_COUNT },
    };
    expect(clientMessageSchema.safeParse(valid).success).toBe(true);
    const fractionalCount = Number.parseFloat('1.5');
    for (const selectedCount of [-1, 0, fractionalCount, MAX_PRESENCE_SELECTION_COUNT + 1]) {
      expect(
        clientMessageSchema.safeParse({ ...valid, data: { ...valid.data, selectedCount } }).success,
      ).toBe(false);
    }
  });

  it('rejects excessive or repeated drag preview positions', () => {
    const positions = Array.from({ length: MAX_DRAG_PREVIEW_POSITIONS + 1 }, (_unused, index) => ({
      id: testUuid(index + 1),
      position: { x: 0, y: 0 },
    }));
    const message = {
      event: CLIENT_EVENT_NAMES.PRESENCE,
      data: { ...presence, dragPreview: { positions } },
    };
    expect(clientMessageSchema.safeParse(message).success).toBe(false);
    expect(
      clientMessageSchema.safeParse({
        ...message,
        data: { ...message.data, dragPreview: { positions: [positions[0], positions[0]] } },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown server fields, invalid roles and oversized safe errors', () => {
    const error = {
      event: SERVER_EVENT_NAMES.ERROR,
      data: {
        code: ERROR_CODES.DOCUMENT_INVALID,
        message: 'Invalid update.',
        retryable: false,
      },
    };
    expect(
      serverMessageSchema.safeParse({ ...error, data: { ...error.data, detail: 'private' } })
        .success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        ...error,
        data: { ...error.data, message: 'x'.repeat(MAX_WS_ERROR_MESSAGE_CHARACTERS + 1) },
      }).success,
    ).toBe(false);
    expect(
      serverMessageSchema.safeParse({
        event: SERVER_EVENT_NAMES.ACCESS_CHANGED,
        data: {
          role: 'administrator',
          archived: false,
        },
      }).success,
    ).toBe(false);
  });
});
