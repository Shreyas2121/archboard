import { z } from 'zod';

import { errorCodeSchema } from '../errors/index.js';
import { userIdSchema } from '../auth/index.js';
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
  MAX_PRESENCE_SELECTION_COUNT,
  MAX_PRESENCE_USER_ID_CHARACTERS,
  MAX_PRESENCE_USER_NAME_CHARACTERS,
  MAX_WS_ERROR_MESSAGE_CHARACTERS,
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

// These event names are reserved for later phases. They are not accepted as Phase 4 client messages.
export const RESERVED_CLIENT_EVENT_NAMES = {
  PRESENTER_ACQUIRE: 'presenter.acquire',
  PRESENTER_STEP: 'presenter.step',
  PRESENTER_RELEASE: 'presenter.release',
} as const;
export const RESERVED_SERVER_EVENT_NAMES = { PRESENTER: 'presenter' } as const;

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
const POSTGRES_BIGINT_MAX_DIGITS = 19;
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
  .max(POSTGRES_BIGINT_MAX_DIGITS)
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

function hasCanonicalBase64Shape(value: string): boolean {
  if (value.length % BASE64_BLOCK_CHARACTERS !== 0) {
    return false;
  }

  const paddingCharacters = value.endsWith('==')
    ? DOUBLE_PADDING_CHARACTERS
    : value.endsWith('=')
      ? SINGLE_PADDING_CHARACTER
      : 0;
  const dataCharacterCount = value.length - paddingCharacters;

  for (let index = 0; index < dataCharacterCount; index += 1) {
    if (!BASE64_ALPHABET.includes(value[index]!)) {
      return false;
    }
  }

  for (let index = dataCharacterCount; index < value.length; index += 1) {
    if (value[index] !== '=') {
      return false;
    }
  }

  return true;
}

function canonicalBase64Schema(maxDecodedBytes: number) {
  const maxEncodedCharacters =
    Math.ceil(maxDecodedBytes / BYTES_PER_BASE64_BLOCK) * BASE64_BLOCK_CHARACTERS;

  return z
    .string()
    .min(1)
    .superRefine((value, context) => {
      if (value.length > maxEncodedCharacters || decodedBase64ByteLength(value) > maxDecodedBytes) {
        context.addIssue({
          code: 'custom',
          message: `Decoded Yjs bytes must not exceed ${maxDecodedBytes} bytes.`,
        });
        return;
      }

      if (!hasCanonicalBase64Shape(value)) {
        context.addIssue({
          code: 'custom',
          message: 'Yjs bytes must use canonical padded base64.',
        });
        return;
      }

      if (!hasCanonicalBase64Padding(value)) {
        context.addIssue({
          code: 'custom',
          message: 'Yjs bytes must use canonical base64 padding bits.',
        });
        return;
      }
    });
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

export const dragPreviewSchema = z.strictObject({
  positions: z
    .array(z.strictObject({ id: applicationIdSchema, position: pointSchema }))
    .max(MAX_DRAG_PREVIEW_POSITIONS)
    .refine(
      (positions) => new Set(positions.map(({ id }) => id)).size === positions.length,
      'A drag preview must not contain duplicate IDs.',
    ),
});

export const presenceStateSchema = z
  .strictObject({
    cursor: pointSchema.nullable(),
    selectedIds: uniqueApplicationIdListSchema,
    selectedCount: z.number().int().nonnegative().max(MAX_PRESENCE_SELECTION_COUNT).optional(),
    dragPreview: dragPreviewSchema.nullable(),
  })
  .refine(
    (value) => value.selectedCount === undefined || value.selectedCount >= value.selectedIds.length,
    'Presence selection count cannot be smaller than the included IDs.',
  );

export const readyLimitsSchema = z.strictObject({
  maxClientUpdateBytes: z.literal(MAX_CLIENT_UPDATE_BYTES),
  maxEncodedYjsStateBytes: z.literal(MAX_ENCODED_YJS_STATE_BYTES),
  maxWebSocketFrameBytes: z.literal(MAX_WS_FRAME_BYTES),
  maxLiveNodes: z.literal(MAX_LIVE_NODES),
  maxLiveEdges: z.literal(MAX_LIVE_EDGES),
  maxLiveBoundaries: z.literal(MAX_LIVE_BOUNDARIES),
  maxLivePresentationSteps: z.literal(MAX_LIVE_PRESENTATION_STEPS),
  maxPresenceSelectedIds: z.literal(MAX_PRESENCE_SELECTED_IDS),
});

export const helloMessageSchema = z.strictObject({
  event: z.literal(CLIENT_EVENT_NAMES.HELLO),
  data: z.strictObject({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
    tabId: applicationIdSchema,
  }),
});

export const clientUpdateMessageSchema = z.strictObject({
  event: z.literal(CLIENT_EVENT_NAMES.UPDATE),
  data: z.strictObject({
    updateId: applicationIdSchema,
    updateBase64: clientUpdateBase64Schema,
  }),
});

export const clientPresenceMessageSchema = z.strictObject({
  event: z.literal(CLIENT_EVENT_NAMES.PRESENCE),
  data: presenceStateSchema,
});

export const clientMessageSchema = z.discriminatedUnion('event', [
  helloMessageSchema,
  clientUpdateMessageSchema,
  clientPresenceMessageSchema,
]);

export const readyMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.READY),
  data: z.strictObject({
    role: boardRoleSchema,
    latestSeq: serverSequenceSchema,
    snapshotBase64: snapshotBase64Schema,
    connectionId: applicationIdSchema,
    limits: readyLimitsSchema,
  }),
});

export const acknowledgementMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.ACK),
  data: z.strictObject({
    updateId: applicationIdSchema,
    seq: serverSequenceSchema,
  }),
});

export const serverUpdateMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.UPDATE),
  data: z.strictObject({
    updateBase64: clientUpdateBase64Schema,
    seq: serverSequenceSchema,
  }),
});

export const serverPresenceMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.PRESENCE),
  data: z.strictObject({
    connectionId: applicationIdSchema,
    user: z.strictObject({
      id: userIdSchema.max(MAX_PRESENCE_USER_ID_CHARACTERS),
      name: z.string().max(MAX_PRESENCE_USER_NAME_CHARACTERS),
      color: colorTokenSchema,
    }),
    presence: presenceStateSchema,
    expiresAt: z.iso.datetime(),
  }),
});

export const errorMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.ERROR),
  data: z.strictObject({
    code: errorCodeSchema,
    message: z.string().min(1).max(MAX_WS_ERROR_MESSAGE_CHARACTERS),
    retryable: z.boolean(),
    updateId: applicationIdSchema.optional(),
  }),
});

export const accessChangedMessageSchema = z.strictObject({
  event: z.literal(SERVER_EVENT_NAMES.ACCESS_CHANGED),
  data: z.strictObject({
    role: boardRoleSchema.nullable(),
    archived: z.boolean(),
  }),
});

// Reserved for later REST resources; parsing the shape does not implement invalidation.
export const invalidateMessageSchema = z.strictObject({
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
export type PresenceState = z.infer<typeof presenceStateSchema>;
export type HelloMessage = z.infer<typeof helloMessageSchema>;
export type ClientUpdateMessage = z.infer<typeof clientUpdateMessageSchema>;
export type ClientPresenceMessage = z.infer<typeof clientPresenceMessageSchema>;
export type ReadyMessage = z.infer<typeof readyMessageSchema>;
export type AcknowledgementMessage = z.infer<typeof acknowledgementMessageSchema>;
export type ServerUpdateMessage = z.infer<typeof serverUpdateMessageSchema>;
export type ServerPresenceMessage = z.infer<typeof serverPresenceMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type AccessChangedMessage = z.infer<typeof accessChangedMessageSchema>;
export type InvalidateMessage = z.infer<typeof invalidateMessageSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
