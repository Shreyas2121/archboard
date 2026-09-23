import { z } from 'zod';

import { userIdSchema, userSummarySchema } from '../auth/index.js';
import { applicationIdSchema } from '../graph/index.js';
import {
  INVITE_TOKEN_BYTES,
  MAX_BOARD_DESCRIPTION_CHARACTERS,
  MAX_BOARD_TITLE_CHARACTERS,
} from '../limits/index.js';
import {
  collectionEnvelopeSchema,
  objectEnvelopeSchema,
  utcTimestampSchema,
} from '../http/index.js';
import { BOARD_ROLES, boardRoleSchema, serverSequenceSchema } from '../protocol/index.js';
import { pageCursorSchema, pageLimitQuerySchema } from '../pagination/index.js';

const base64BitsPerCharacter = 6;
const bitsPerByte = 8;

export const boardTitleSchema = z.string().trim().min(1).max(MAX_BOARD_TITLE_CHARACTERS);
export const boardDescriptionSchema = z.string().max(MAX_BOARD_DESCRIPTION_CHARACTERS);
export const metadataVersionSchema = z.number().int().min(1);
export const boardIdPathSchema = z.strictObject({ id: applicationIdSchema });
export const memberPathSchema = boardIdPathSchema.safeExtend({ userId: userIdSchema });
export const invitePathSchema = boardIdPathSchema.safeExtend({ inviteId: applicationIdSchema });

export const boardSummarySchema = z.strictObject({
  id: applicationIdSchema,
  title: boardTitleSchema,
  description: boardDescriptionSchema,
  owner: userSummarySchema,
  effectiveRole: boardRoleSchema,
  archivedAt: utcTimestampSchema.nullable(),
  metadataVersion: metadataVersionSchema,
  latestSeq: serverSequenceSchema,
  contentUpdatedAt: utcTimestampSchema,
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
});

export const boardDetailSchema = boardSummarySchema.safeExtend({
  memberCount: z.number().int().min(1),
});

export const boardListQuerySchema = z.strictObject({
  search: z.string().trim().max(MAX_BOARD_TITLE_CHARACTERS).optional(),
  archived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  cursor: pageCursorSchema.optional(),
  limit: pageLimitQuerySchema,
});

export const inviteListQuerySchema = boardListQuerySchema.pick({ cursor: true, limit: true });

export const createBoardSchema = z.strictObject({
  title: boardTitleSchema,
  description: boardDescriptionSchema.optional(),
});

export const patchBoardSchema = z
  .strictObject({
    title: boardTitleSchema.optional(),
    description: boardDescriptionSchema.optional(),
    expectedVersion: metadataVersionSchema,
  })
  .refine((value) => value.title !== undefined || value.description !== undefined);

export const boardVersionRequestSchema = z.strictObject({ expectedVersion: metadataVersionSchema });
export const duplicateBoardSchema = z.strictObject({ title: boardTitleSchema });

export const memberRoleSchema = z.enum([BOARD_ROLES.EDITOR, BOARD_ROLES.VIEWER]);
export const boardMemberSchema = z.strictObject({
  user: userSummarySchema,
  role: boardRoleSchema,
  joinedAt: utcTimestampSchema,
});
export const changeMemberRoleSchema = z.strictObject({ role: memberRoleSchema });

export const inviteStatusSchema = z.enum(['active', 'expired', 'revoked', 'accepted']);
export const boardInviteSchema = z.strictObject({
  id: applicationIdSchema,
  role: memberRoleSchema,
  createdBy: userSummarySchema,
  createdAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  status: inviteStatusSchema,
});
export const createInviteSchema = z.strictObject({ role: memberRoleSchema });
export const inviteCreateResultSchema = boardInviteSchema
  .safeExtend({
    inviteUrl: z.url({ protocol: /^https?$/ }).nullable(),
    inviteUrlAvailable: z.boolean(),
  })
  .refine((value) => value.inviteUrlAvailable === (value.inviteUrl !== null));

// 32 bytes produce 43 unpadded base64url characters; the final character has canonical zero bits.
export const INVITE_TOKEN_CHARACTERS = Math.ceil(
  (INVITE_TOKEN_BYTES * bitsPerByte) / base64BitsPerCharacter,
);
const inviteTokenPattern = new RegExp(
  `^[A-Za-z0-9_-]{${INVITE_TOKEN_CHARACTERS - 1}}[AEIMQUYcgkosw048]$`,
);
export const inviteTokenSchema = z
  .string()
  .length(INVITE_TOKEN_CHARACTERS)
  .regex(inviteTokenPattern);
export const inviteTokenRequestSchema = z.strictObject({ token: inviteTokenSchema });
export const invitePreviewSchema = z.strictObject({
  boardTitle: boardTitleSchema,
  inviterName: z.string(),
  role: memberRoleSchema,
  expiresAt: utcTimestampSchema,
});
export const inviteAcceptanceSchema = z.strictObject({
  boardId: applicationIdSchema,
  effectiveRole: boardRoleSchema,
});

export const boardSummaryResponseSchema = objectEnvelopeSchema(boardSummarySchema);
export const boardDetailResponseSchema = objectEnvelopeSchema(boardDetailSchema);
export const boardListResponseSchema = collectionEnvelopeSchema(
  boardSummarySchema,
  pageCursorSchema,
);
export const boardMembersResponseSchema = collectionEnvelopeSchema(boardMemberSchema, z.null());
export const boardMemberResponseSchema = objectEnvelopeSchema(boardMemberSchema);
export const boardInviteResponseSchema = objectEnvelopeSchema(inviteCreateResultSchema);
export const boardInviteListResponseSchema = collectionEnvelopeSchema(
  boardInviteSchema,
  pageCursorSchema,
);
export const invitePreviewResponseSchema = objectEnvelopeSchema(invitePreviewSchema);
export const inviteAcceptanceResponseSchema = objectEnvelopeSchema(inviteAcceptanceSchema);

export type BoardSummary = z.infer<typeof boardSummarySchema>;
export type BoardDetail = z.infer<typeof boardDetailSchema>;
export type BoardListQuery = z.infer<typeof boardListQuerySchema>;
export type InviteListQuery = z.infer<typeof inviteListQuerySchema>;
export type CreateBoard = z.infer<typeof createBoardSchema>;
export type PatchBoard = z.infer<typeof patchBoardSchema>;
export type BoardVersionRequest = z.infer<typeof boardVersionRequestSchema>;
export type DuplicateBoard = z.infer<typeof duplicateBoardSchema>;
export type BoardMember = z.infer<typeof boardMemberSchema>;
export type ChangeMemberRole = z.infer<typeof changeMemberRoleSchema>;
export type BoardInvite = z.infer<typeof boardInviteSchema>;
export type CreateInvite = z.infer<typeof createInviteSchema>;
export type InviteCreateResult = z.infer<typeof inviteCreateResultSchema>;
export type InviteTokenRequest = z.infer<typeof inviteTokenRequestSchema>;
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
export type InviteAcceptance = z.infer<typeof inviteAcceptanceSchema>;
export type BoardSummaryResponse = z.infer<typeof boardSummaryResponseSchema>;
export type BoardDetailResponse = z.infer<typeof boardDetailResponseSchema>;
export type BoardListResponse = z.infer<typeof boardListResponseSchema>;
export type BoardMembersResponse = z.infer<typeof boardMembersResponseSchema>;
export type BoardMemberResponse = z.infer<typeof boardMemberResponseSchema>;
export type BoardInviteResponse = z.infer<typeof boardInviteResponseSchema>;
export type BoardInviteListResponse = z.infer<typeof boardInviteListResponseSchema>;
export type InvitePreviewResponse = z.infer<typeof invitePreviewResponseSchema>;
export type InviteAcceptanceResponse = z.infer<typeof inviteAcceptanceResponseSchema>;
