import { z } from 'zod';

import { errorCodeSchema } from '../errors/index.js';
import {
  applicationIdSchema,
  colorTokenSchema,
  GRAPH_SCHEMA_VERSION,
  pointSchema,
} from '../graph/index.js';
import {
  MAX_CLIENT_UPDATE_BYTES,
  MAX_DRAG_PREVIEW_POSITIONS,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_WS_FRAME_BYTES,
} from '../limits/index.js';

export const PROTOCOL_VERSION = 1 as const;
export const SERVER_SEQUENCE_ZERO = '0' as const;

export const CLIENT_EVENT_NAMES = {
  HELLO: 'hello',
  UPDATE: 'update',
  PRESENCE: 'presence',
} as const;

export const SERVER_EVENT_NAMES = {
  READY: 'ready',
  ACK: 'ack',
  UPDATE: 'update',
  PRESENCE: 'presence',
  ERROR: 'error',
  ACCESS_CHANGED: 'access.changed',
  INVALIDATE: 'invalidate',
} as const;

export const BOARD_ROLES = {
  OWNER: 'owner',
  EDITOR: 'editor',
  VIEWER: 'viewer',
} as const;

export const INVALIDATION_RESOURCES = {
  COMMENTS: 'comments',
  MEMBERS: 'members',
  METADATA: 'metadata',
  CHECKPOINTS: 'checkpoints',
} as const;

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_BLOCK_CHARACTERS = 4;
const BYTES_PER_BASE64_BLOCK = 3;
const DOUBLE_PADDING_DATA_CHARACTER_INDEX = -3;
const SINGLE_PADDING_DATA_CHARACTER_INDEX = -2;
const DOUBLE_PADDING_CANONICAL_DIVISOR = 16;
const SINGLE_PADDING_CANONICAL_DIVISOR = 4;
const DOUBLE_PADDING_CHARACTERS = 2;
const SINGLE_PADDING_CHARACTER = 1;
const SERVER_SEQUENCE_PATTERN = /^(?:0|[1-9]\d*)$/;

export const serverSequenceSchema = z
  .string()
  .regex(
    SERVER_SEQUENCE_PATTERN,
    'A server sequence must be a canonical non-negative decimal string.',
  )
  .refine(
    (value) => SERVER_SEQUENCE_PATTERN.test(value) && BigInt(value) <= POSTGRES_BIGINT_MAX,
    'A server sequence must fit PostgreSQL bigint.',
  );

function decodedBase64ByteLength(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  const paddingCharacters = value.endsWith('==')
    ? DOUBLE_PADDING_CHARACTERS
    : value.endsWith('=')
      ? SINGLE_PADDING_CHARACTER
      : 0;
  return (value.length / BASE64_BLOCK_CHARACTERS) * BYTES_PER_BASE64_BLOCK - paddingCharacters;
}

function hasCanonicalBase64Padding(value: string): boolean {
  if (value.endsWith('==')) {
    const dataCharacter = value.at(DOUBLE_PADDING_DATA_CHARACTER_INDEX);
    return (
      dataCharacter !== undefined &&
      BASE64_ALPHABET.indexOf(dataCharacter) % DOUBLE_PADDING_CANONICAL_DIVISOR === 0
    );
  }

  if (value.endsWith('=')) {
    const dataCharacter = value.at(SINGLE_PADDING_DATA_CHARACTER_INDEX);
    return (
      dataCharacter !== undefined &&
      BASE64_ALPHABET.indexOf(dataCharacter) % SINGLE_PADDING_CANONICAL_DIVISOR === 0
    );
  }

  return true;
}

function canonicalBase64Schema(maxDecodedBytes: number) {
  return z
    .string()
    .regex(CANONICAL_BASE64_PATTERN, 'Yjs bytes must use canonical padded base64.')
    .refine(hasCanonicalBase64Padding, 'Yjs bytes must use canonical base64 padding bits.')
    .refine(
      (value) => decodedBase64ByteLength(value) <= maxDecodedBytes,
      `Decoded Yjs bytes must not exceed ${maxDecodedBytes} bytes.`,
    );
}

export const clientUpdateBase64Schema = canonicalBase64Schema(MAX_CLIENT_UPDATE_BYTES);
export const snapshotBase64Schema = canonicalBase64Schema(MAX_ENCODED_YJS_STATE_BYTES);

export const boardRoleSchema = z.enum(BOARD_ROLES);
export const invalidationResourceSchema = z.enum(INVALIDATION_RESOURCES);

const uniqueApplicationIdListSchema = z
  .array(applicationIdSchema)
  .max(MAX_PRESENCE_SELECTED_IDS)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Presence selections must not contain duplicate IDs.',
  );

const dragPreviewSchema = z.strictObject({
  positions: z
    .array(z.strictObject({ id: applicationIdSchema, position: pointSchema }))
    .max(MAX_DRAG_PREVIEW_POSITIONS)
    .refine(
      (positions) => new Set(positions.map(({ id }) => id)).size === positions.length,
      'A drag preview must not contain duplicate IDs.',
    ),
});

const presenceStateSchema = z.strictObject({
  cursor: pointSchema.nullable(),
  selectedIds: uniqueApplicationIdListSchema,
  dragPreview: dragPreviewSchema.nullable(),
});

const readyLimitsSchema = z.strictObject({
  maxClientUpdateBytes: z.literal(MAX_CLIENT_UPDATE_BYTES),
  maxEncodedYjsStateBytes: z.literal(MAX_ENCODED_YJS_STATE_BYTES),
  maxWebSocketFrameBytes: z.literal(MAX_WS_FRAME_BYTES),
  maxLiveNodes: z.literal(MAX_LIVE_NODES),
  maxLiveEdges: z.literal(MAX_LIVE_EDGES),
  maxLiveBoundaries: z.literal(MAX_LIVE_BOUNDARIES),
  maxLivePresentationSteps: z.literal(MAX_LIVE_PRESENTATION_STEPS),
  maxPresenceSelectedIds: z.literal(MAX_PRESENCE_SELECTED_IDS),
});

const helloMessageSchema = z.strictObject({
  event: z.literal(CLIENT_EVENT_NAMES.HELLO),
  data: z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
    tabId: applicationIdSchema,
  }),
});

const clientUpdateMessageSchema = z.strictObject({
  event: z.literal(CLIENT_EVENT_NAMES.UPDATE),
  data: z.strictObject({
    updateId: applicationIdSchema,
    updateBase64: clientUpdateBase64Schema,
  }),
});

const clientPresenceMessageSchema = z.strictObject({
  event: z.literal(CLIENT_EVENT_NAMES.PRESENCE),
  data: presenceStateSchema,
});

export const clientMessageSchema = z.discriminatedUnion('event', [
  helloMessageSchema,
  clientUpdateMessageSchema,
  clientPresenceMessageSchema,
]);

const readyMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.READY),
  data: z.strictObject({
    role: boardRoleSchema,
    latestSeq: serverSequenceSchema,
    snapshotBase64: snapshotBase64Schema,
    connectionId: applicationIdSchema,
    limits: readyLimitsSchema,
  }),
});

const acknowledgementMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.ACK),
  data: z.strictObject({
    updateId: applicationIdSchema,
    seq: serverSequenceSchema,
  }),
});

const serverUpdateMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.UPDATE),
  data: z.strictObject({
    updateBase64: clientUpdateBase64Schema,
    seq: serverSequenceSchema,
  }),
});

const serverPresenceMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.PRESENCE),
  data: z.strictObject({
    connectionId: applicationIdSchema,
    user: z.strictObject({
      id: z.string().min(1),
      name: z.string(),
      color: colorTokenSchema,
    }),
    presence: presenceStateSchema,
    expiresAt: z.iso.datetime(),
  }),
});

const errorMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.ERROR),
  data: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    updateId: applicationIdSchema.optional(),
  }),
});

const accessChangedMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.ACCESS_CHANGED),
  data: z.strictObject({
    role: boardRoleSchema.nullable(),
    archived: z.boolean(),
  }),
});

const invalidateMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.INVALIDATE),
  data: z.strictObject({
    resource: invalidationResourceSchema,
  }),
});

export const serverMessageSchema = z.discriminatedUnion('event', [
  readyMessageSchema,
  acknowledgementMessageSchema,
  serverUpdateMessageSchema,
  serverPresenceMessageSchema,
  errorMessageSchema,
  accessChangedMessageSchema,
  invalidateMessageSchema,
]);

export type ServerSequence = z.infer<typeof serverSequenceSchema>;
export type BoardRole = z.infer<typeof boardRoleSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
