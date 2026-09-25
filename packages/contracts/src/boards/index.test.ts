import { describe, expect, it } from 'vitest';

import {
  boardDetailSchema,
  boardListQuerySchema,
  boardListResponseSchema,
  boardMemberSchema,
  boardMembersResponseSchema,
  boardSummarySchema,
  changeMemberRoleSchema,
  createBoardSchema,
  duplicateBoardSchema,
  inviteCreateResultSchema,
  inviteListQuerySchema,
  INVITE_TOKEN_CHARACTERS,
  inviteTokenRequestSchema,
  metadataVersionSchema,
  patchBoardSchema,
} from './index.js';
import {
  MAX_BOARD_DESCRIPTION_CHARACTERS,
  MAX_BOARD_PAGE_SIZE,
  MAX_BOARD_TITLE_CHARACTERS,
} from '../limits/index.js';
import { decodePageCursor, encodePageCursor } from '../pagination/index.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const timestamp = '2026-09-23T10:00:00.000Z';
const user = { id: 'better-auth-opaque-id', name: 'Example', image: null };
const summary = {
  id,
  title: 'Board',
  description: '',
  owner: user,
  effectiveRole: 'owner',
  archivedAt: null,
  metadataVersion: 1,
  latestSeq: '0',
  contentUpdatedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('Phase 3 board wire contracts', () => {
  it('trims titles, bounds descriptions, and rejects unknown or actor-controlled fields', () => {
    expect(createBoardSchema.parse({ title: ' Board ' })).toEqual({ title: 'Board' });
    expect(
      createBoardSchema.safeParse({ title: ' '.repeat(MAX_BOARD_TITLE_CHARACTERS) }).success,
    ).toBe(false);
    expect(
      createBoardSchema.safeParse({ title: 'x'.repeat(MAX_BOARD_TITLE_CHARACTERS + 1) }).success,
    ).toBe(false);
    expect(
      createBoardSchema.safeParse({
        title: 'x',
        description: 'd'.repeat(MAX_BOARD_DESCRIPTION_CHARACTERS),
      }).success,
    ).toBe(true);
    expect(
      createBoardSchema.safeParse({
        title: 'x',
        description: 'd'.repeat(MAX_BOARD_DESCRIPTION_CHARACTERS + 1),
      }).success,
    ).toBe(false);
    expect(createBoardSchema.safeParse({ title: 'x', ownerUserId: user.id }).success).toBe(false);
    expect(duplicateBoardSchema.safeParse({ title: 'Copy', idempotencyKey: id }).success).toBe(
      false,
    );
    expect(patchBoardSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(
      patchBoardSchema.safeParse({ title: 'New', expectedVersion: 1, latestSeq: '1' }).success,
    ).toBe(false);
    expect(metadataVersionSchema.safeParse(0).success).toBe(false);
  });

  it('validates stable opaque cursors, strict query booleans, and page bounds', () => {
    const cursor = encodePageCursor(timestamp, id);
    expect(decodePageCursor(cursor)).toEqual({ timestamp, id });
    expect(
      boardListQuerySchema.parse({ cursor, archived: 'true', limit: String(MAX_BOARD_PAGE_SIZE) }),
    ).toEqual({ cursor, archived: true, limit: MAX_BOARD_PAGE_SIZE });
    expect(boardListQuerySchema.parse({})).toEqual({ archived: false, limit: 30 });
    expect(inviteListQuerySchema.parse({ cursor })).toEqual({ cursor, limit: 30 });
    expect(inviteListQuerySchema.safeParse({ archived: 'true' }).success).toBe(false);
    for (const query of [
      { archived: 'yes' },
      { limit: '0' },
      { limit: String(MAX_BOARD_PAGE_SIZE + 1) },
      { limit: '01' },
      { limit: 2 },
      { cursor: 'garbage' },
      { cursor: `${cursor}A` },
      { cursor: cursor.slice(0, -1) },
      { cursor: 'é' },
      { surprise: 'x' },
    ])
      expect(boardListQuerySchema.safeParse(query).success).toBe(false);
  });

  it('keeps opaque user IDs, UUID application IDs, UTC timestamps, and bigint sequences distinct', () => {
    expect(boardSummarySchema.parse(summary).owner.id).toBe(user.id);
    expect(boardDetailSchema.parse({ ...summary, memberCount: 1 }).latestSeq).toBe('0');
    expect(boardListResponseSchema.parse({ data: [summary], nextCursor: null }).data).toHaveLength(
      1,
    );
    for (const invalid of [
      { ...summary, id: user.id },
      { ...summary, latestSeq: 0 },
      { ...summary, latestSeq: '01' },
      { ...summary, latestSeq: '9223372036854775808' },
      { ...summary, createdAt: '2026-09-23T10:00:00+05:30' },
      { ...summary, effectiveRole: 'admin' },
      { ...summary, tokenHash: 'private' },
    ])
      expect(boardSummarySchema.safeParse(invalid).success).toBe(false);
    expect(boardMemberSchema.safeParse({ user, role: 'owner', joinedAt: timestamp }).success).toBe(
      true,
    );
    expect(boardMembersResponseSchema.safeParse({ data: [], nextCursor: null }).success).toBe(true);
    expect(
      boardMembersResponseSchema.safeParse({ data: [], nextCursor: 'unexpected' }).success,
    ).toBe(false);
    expect(changeMemberRoleSchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('accepts only canonical 32-byte invite tokens and enforces redacted replays', () => {
    const token = 'A'.repeat(INVITE_TOKEN_CHARACTERS);
    expect(inviteTokenRequestSchema.safeParse({ token }).success).toBe(true);
    for (const candidate of [
      token.slice(1),
      `${token.slice(0, -1)}B`,
      `${token}=`,
      'x'.repeat(INVITE_TOKEN_CHARACTERS),
    ]) {
      expect(inviteTokenRequestSchema.safeParse({ token: candidate }).success).toBe(false);
    }
    const invite = {
      id,
      role: 'viewer',
      createdBy: user,
      createdAt: timestamp,
      expiresAt: timestamp,
      status: 'active',
    };
    expect(
      inviteCreateResultSchema.safeParse({ ...invite, inviteUrl: null, inviteUrlAvailable: false })
        .success,
    ).toBe(true);
    expect(
      inviteCreateResultSchema.safeParse({
        ...invite,
        inviteUrl: 'https://example.test/invite',
        inviteUrlAvailable: true,
      }).success,
    ).toBe(true);
    expect(
      inviteCreateResultSchema.safeParse({ ...invite, inviteUrl: null, inviteUrlAvailable: true })
        .success,
    ).toBe(false);
    expect(
      inviteCreateResultSchema.safeParse({
        ...invite,
        inviteUrl: 'https://example.test/invite',
        inviteUrlAvailable: false,
      }).success,
    ).toBe(false);
    expect(
      inviteCreateResultSchema.safeParse({
        ...invite,
        inviteUrl: null,
        inviteUrlAvailable: false,
        tokenHash: 'secret',
      }).success,
    ).toBe(false);
  });
});
