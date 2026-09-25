import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import {
  ERROR_CODES,
  INVITE_LIFETIME_DAYS,
  INVITE_TOKEN_BYTES,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardInviteListResponseSchema,
  boardInviteResponseSchema,
  currentUserResponseSchema,
  inviteAcceptanceResponseSchema,
  invitePreviewResponseSchema,
} from '@archboard/contracts';
import { jest } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';

import { AppModule } from '../../app.module.js';
import { InitialDatabaseFoundation1789300000000 } from '../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { loadApiConfig } from '../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../platform/database/database-entities.js';
import { BetterAuthRuntime, configureAuthHttp } from '../auth/index.js';
import { AUTH_REQUEST_ACTOR, type RequestActor } from '../auth/application/index.js';
import { InviteService } from './application/invite-service.js';
import { BoardPermissionService } from './application/permissions/index.js';
import { PostgresBoardAuthorityReader } from './infrastructure/postgres-board-authority-reader.js';
import { PostgresInvitePersistence } from './infrastructure/postgres-invite-persistence.js';
import { digestInviteToken } from './infrastructure/invite-token.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'p308-test-password-32-characters';
const TEST_TIMEOUT_MS = 90_000;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
const HTTP_UNAVAILABLE = 503;
const SCHEMA_SUFFIX_LENGTH = 8;
const SHA256_DIGEST_BYTES = 32;
const MILLISECONDS_PER_DAY = 86_400_000;
const COMPETING_ACCEPTORS = 2;
const SCHEMA = `archboard_p308_${process.pid}_${randomUUID().replaceAll('-', '').slice(0, SCHEMA_SUFFIX_LENGTH)}`;

jest.setTimeout(TEST_TIMEOUT_MS);

function scopedUrl(directUrl: string): string {
  const url = new URL(directUrl);
  url.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return url.toString();
}

function cookies(response: Response): string {
  const all = response.headers.getSetCookie();
  expect(all.some((value) => value.includes('HttpOnly'))).toBe(true);
  return all.map((value) => value.split(';', 1)[0]).join('; ');
}

describe('board invitations with real Better Auth cookies and PostgreSQL', () => {
  let admin: Pool;
  let database: DataSource;
  let application: NestExpressApplication;
  let apiOrigin: string;
  const users = new Map<string, { id: string; cookie: string }>();

  async function request(
    path: string,
    user?: string,
    options?: { method?: string; body?: unknown; key?: string },
  ) {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (user) headers.cookie = users.get(user)!.cookie;
    if (options?.body !== undefined) headers['content-type'] = 'application/json';
    if (options?.key) headers['idempotency-key'] = options.key;
    return fetch(`${apiOrigin}/api/v1${path}`, {
      method: options?.method ?? 'GET',
      headers,
      ...(options?.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  }

  async function createBoard(title: string) {
    const response = await request('/boards', 'owner', {
      method: 'POST',
      key: randomUUID(),
      body: { title },
    });
    expect(response.status).toBe(HTTP_CREATED);
    return boardDetailResponseSchema.parse(await response.json()).data;
  }

  async function createInvite(boardId: string, role: 'editor' | 'viewer', key = randomUUID()) {
    const response = await request(`/boards/${boardId}/invites`, 'owner', {
      method: 'POST',
      key,
      body: { role },
    });
    expect(response.status).toBe(HTTP_CREATED);
    const invite = boardInviteResponseSchema.parse(await response.json()).data;
    expect(invite.inviteUrlAvailable).toBe(true);
    return { invite, token: new URL(invite.inviteUrl!).pathname.split('/').at(-1)! };
  }

  beforeAll(async () => {
    const directUrl = process.env.DATABASE_DIRECT_URL;
    if (!directUrl)
      throw new Error('DATABASE_DIRECT_URL is required for invitation integration tests.');
    admin = new Pool({ connectionString: directUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    const url = scopedUrl(directUrl);
    database = new DataSource({
      type: 'postgres',
      url,
      schema: SCHEMA,
      entities: [...DATABASE_ENTITIES],
      migrations: [InitialDatabaseFoundation1789300000000],
      synchronize: false,
      migrationsRun: false,
      extra: { max: 8, options: `-c search_path=${SCHEMA}` },
    });
    await database.initialize();
    await database.runMigrations({ transaction: 'all' });
    const config = loadApiConfig({
      NODE_ENV: 'test',
      PUBLIC_API_ORIGIN: 'http://localhost:3000',
      ALLOWED_WEB_ORIGINS: ORIGIN,
      PORT: '3000',
      DATABASE_URL: url,
      DATABASE_DIRECT_URL: url,
      BETTER_AUTH_SECRET: 'p308-auth-integration-secret-32chars',
      GITHUB_CLIENT_ID: 'Ov23liExampleClientId1234567890',
      GITHUB_CLIENT_SECRET: '0123456789abcdef0123456789abcdef01234567',
    });
    application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
      bodyParser: false,
      logger: false,
    });
    configureAuthHttp(application, application.get(BetterAuthRuntime), config);
    await application.listen(0, '127.0.0.1');
    apiOrigin = `http://127.0.0.1:${(application.getHttpServer().address() as AddressInfo).port}`;
    for (const name of ['owner', 'editor', 'viewer', 'outsider']) {
      const signup = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          email: `p308-${name}-${randomUUID()}@example.test`,
          password: PASSWORD,
        }),
      });
      expect(signup.status).toBe(HTTP_OK);
      const cookie = cookies(signup);
      const me = await fetch(`${apiOrigin}/api/v1/me`, { headers: { origin: ORIGIN, cookie } });
      users.set(name, { id: currentUserResponseSchema.parse(await me.json()).data.id, cookie });
    }
  });

  afterAll(async () => {
    try {
      await application?.close();
      if (database?.isInitialized) await database.destroy();
    } finally {
      if (admin) {
        try {
          await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        } finally {
          await admin.end();
        }
      }
    }
  });

  it('creates one-time URLs, stores digests and redacted replay, and lists safe metadata', async () => {
    const board = await createBoard('Invitation source');
    await database.query(
      'INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)',
      [board.id, users.get('editor')!.id, 'editor'],
    );
    const key = randomUUID();
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { invite, token } = await createInvite(board.id, 'editor', key);
      expect(Buffer.from(token, 'base64url').byteLength).toBe(INVITE_TOKEN_BYTES);
      expect(invite.inviteUrl!.startsWith(`${ORIGIN}/invite/`)).toBe(true);
      const stored = (await database.query(
        'SELECT token_hash, expires_at, created_at FROM board_invites WHERE id = $1',
        [invite.id],
      )) as { token_hash: Buffer; expires_at: Date; created_at: Date }[];
      expect(stored[0]?.token_hash.byteLength).toBe(SHA256_DIGEST_BYTES);
      expect(stored[0]?.token_hash.equals(digestInviteToken(token)!)).toBe(true);
      expect(stored[0]?.token_hash.includes(Buffer.from(token))).toBe(false);
      expect(stored[0]!.expires_at.getTime() - stored[0]!.created_at.getTime()).toBe(
        INVITE_LIFETIME_DAYS * MILLISECONDS_PER_DAY,
      );
      const replay = await request(`/boards/${board.id}/invites`, 'owner', {
        method: 'POST',
        key,
        body: { role: 'editor' },
      });
      expect(replay.status).toBe(HTTP_CREATED);
      const replayed = boardInviteResponseSchema.parse(await replay.json()).data;
      expect(replayed).toMatchObject({ id: invite.id, inviteUrl: null, inviteUrlAvailable: false });
      const receipts = (await database.query(
        'SELECT response_json FROM api_idempotency WHERE actor_user_id = $1 AND operation = $2 AND key = $3',
        [users.get('owner')!.id, 'invite.create', key],
      )) as { response_json: unknown }[];
      expect(receipts[0]?.response_json).toMatchObject({
        inviteUrl: null,
        inviteUrlAvailable: false,
      });
      expect(JSON.stringify(receipts).includes(token)).toBe(false);
      const capturedLogs = JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls]);
      expect(capturedLogs.includes(token)).toBe(false);
      expect(capturedLogs.includes(stored[0]!.token_hash.toString('hex'))).toBe(false);
      expect(capturedLogs.includes(JSON.stringify({ token }))).toBe(false);
      expect(capturedLogs.includes(invite.inviteUrl!)).toBe(false);
      expect(
        (
          await request(`/boards/${board.id}/invites`, 'owner', {
            method: 'POST',
            key,
            body: { role: 'viewer' },
          })
        ).status,
      ).toBe(HTTP_CONFLICT);
      expect(
        (
          await request(`/boards/${board.id}/invites`, 'editor', {
            method: 'POST',
            key: randomUUID(),
            body: { role: 'viewer' },
          })
        ).status,
      ).toBe(HTTP_FORBIDDEN);
      expect(
        (
          await request(`/boards/${board.id}/invites`, 'owner', {
            method: 'POST',
            key: randomUUID(),
            body: { role: 'owner' },
          })
        ).status,
      ).toBe(HTTP_BAD_REQUEST);

      const preview = await request('/invites/preview', 'outsider', {
        method: 'POST',
        body: { token },
      });
      expect(preview.status).toBe(HTTP_OK);
      expect(invitePreviewResponseSchema.parse(await preview.json()).data).toEqual({
        boardTitle: 'Invitation source',
        inviterName: 'owner',
        role: 'editor',
        expiresAt: invite.expiresAt,
      });
      expect(
        (
          await request('/invites/preview', undefined, {
            method: 'POST',
            body: { token },
          })
        ).status,
      ).toBe(HTTP_UNAUTHORIZED);
      const malformed = await request('/invites/preview', 'outsider', {
        method: 'POST',
        body: { token: 'malformed' },
      });
      expect(malformed.status).toBe(HTTP_NOT_FOUND);
      expect(apiErrorEnvelopeSchema.parse(await malformed.json()).error.code).toBe(
        ERROR_CODES.INVITE_UNAVAILABLE,
      );
      expect(
        (
          await request('/invites/preview', 'outsider', {
            method: 'POST',
            body: {},
          })
        ).status,
      ).toBe(HTTP_NOT_FOUND);
      expect(
        (
          await request('/invites/preview', 'outsider', {
            method: 'POST',
            body: { token, extra: true },
          })
        ).status,
      ).toBe(HTTP_BAD_REQUEST);

      await createInvite(board.id, 'viewer');
      await createInvite(board.id, 'editor');
      const firstPage = boardInviteListResponseSchema.parse(
        await (await request(`/boards/${board.id}/invites?limit=1`, 'owner')).json(),
      );
      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.nextCursor).not.toBeNull();
      const secondPage = boardInviteListResponseSchema.parse(
        await (
          await request(
            `/boards/${board.id}/invites?limit=1&cursor=${firstPage.nextCursor}`,
            'owner',
          )
        ).json(),
      );
      expect(secondPage.data).toHaveLength(1);
      expect(secondPage.data[0]?.id === firstPage.data[0]?.id).toBe(false);
      expect(JSON.stringify(firstPage).includes(token)).toBe(false);
      const otherBoard = await createBoard('Different invitation scope');
      expect(
        (
          await request(`/boards/${otherBoard.id}/invites/${invite.id}`, 'owner', {
            method: 'DELETE',
          })
        ).status,
      ).toBe(HTTP_NOT_FOUND);
      expect((await request(`/boards/${board.id}/invites`, 'outsider')).status).toBe(
        HTTP_NOT_FOUND,
      );
      expect((await request(`/boards/${board.id}/invites`, 'editor')).status).toBe(HTTP_FORBIDDEN);
      expect((await request(`/boards/${board.id}/invites?limit=101`, 'owner')).status).toBe(
        HTTP_BAD_REQUEST,
      );
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('accepts once, upgrades without demotion, and records owner acceptance without a member row', async () => {
    const board = await createBoard('Acceptance roles');
    const viewerInvite = await createInvite(board.id, 'viewer');
    const accepted = await request('/invites/accept', 'viewer', {
      method: 'POST',
      body: { token: viewerInvite.token },
    });
    expect(accepted.status).toBe(HTTP_OK);
    expect(inviteAcceptanceResponseSchema.parse(await accepted.json()).data).toEqual({
      boardId: board.id,
      effectiveRole: 'viewer',
    });
    const retry = await request('/invites/accept', 'viewer', {
      method: 'POST',
      body: { token: viewerInvite.token },
    });
    expect(inviteAcceptanceResponseSchema.parse(await retry.json()).data.effectiveRole).toBe(
      'viewer',
    );
    const exhausted = await request('/invites/accept', 'editor', {
      method: 'POST',
      body: { token: viewerInvite.token },
    });
    expect(exhausted.status).toBe(HTTP_CONFLICT);
    expect(apiErrorEnvelopeSchema.parse(await exhausted.json()).error.code).toBe(
      ERROR_CODES.INVITE_EXHAUSTED,
    );
    expect(
      (
        await request('/invites/preview', 'editor', {
          method: 'POST',
          body: { token: viewerInvite.token },
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    const editorInvite = await createInvite(board.id, 'editor');
    const upgraded = await request('/invites/accept', 'viewer', {
      method: 'POST',
      body: { token: editorInvite.token },
    });
    expect(inviteAcceptanceResponseSchema.parse(await upgraded.json()).data.effectiveRole).toBe(
      'editor',
    );
    const currentRetry = await request('/invites/accept', 'viewer', {
      method: 'POST',
      body: { token: viewerInvite.token },
    });
    expect(inviteAcceptanceResponseSchema.parse(await currentRetry.json()).data.effectiveRole).toBe(
      'editor',
    );
    const weakerInvite = await createInvite(board.id, 'viewer');
    const retained = await request('/invites/accept', 'viewer', {
      method: 'POST',
      body: { token: weakerInvite.token },
    });
    expect(inviteAcceptanceResponseSchema.parse(await retained.json()).data.effectiveRole).toBe(
      'editor',
    );
    const ownerInvite = await createInvite(board.id, 'viewer');
    const ownerAccepted = await request('/invites/accept', 'owner', {
      method: 'POST',
      body: { token: ownerInvite.token },
    });
    expect(
      inviteAcceptanceResponseSchema.parse(await ownerAccepted.json()).data.effectiveRole,
    ).toBe('owner');
    expect(
      (
        await request(`/boards/${board.id}/invites/${ownerInvite.invite.id}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    const ownerRetry = await request('/invites/accept', 'owner', {
      method: 'POST',
      body: { token: ownerInvite.token },
    });
    expect(inviteAcceptanceResponseSchema.parse(await ownerRetry.json()).data.effectiveRole).toBe(
      'owner',
    );
    const ownerRows = (await database.query(
      'SELECT count(*)::integer AS count FROM board_members WHERE board_id = $1 AND user_id = $2',
      [board.id, users.get('owner')!.id],
    )) as { count: number }[];
    expect(ownerRows[0]?.count).toBe(0);
    const viewerRows = (await database.query(
      'SELECT role, count(*)::integer AS count FROM board_members WHERE board_id = $1 AND user_id = $2 GROUP BY role',
      [board.id, users.get('viewer')!.id],
    )) as { role: string; count: number }[];
    expect(viewerRows[0]).toEqual({ role: 'editor', count: 1 });
  });

  it('handles revocation, expiry, archived state, and failed acceptance rollback', async () => {
    const board = await createBoard('Invitation states');
    const revoked = await createInvite(board.id, 'viewer');
    expect(
      (
        await request(`/boards/${board.id}/invites/${revoked.invite.id}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_NO_CONTENT);
    expect(
      (
        await request(`/boards/${board.id}/invites/${revoked.invite.id}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_NO_CONTENT);
    const revokedPreview = await request('/invites/preview', 'viewer', {
      method: 'POST',
      body: { token: revoked.token },
    });
    expect(revokedPreview.status).toBe(HTTP_NOT_FOUND);
    expect(apiErrorEnvelopeSchema.parse(await revokedPreview.json()).error.code).toBe(
      ERROR_CODES.INVITE_UNAVAILABLE,
    );
    expect(
      (
        await request('/invites/accept', 'viewer', {
          method: 'POST',
          body: { token: revoked.token },
        })
      ).status,
    ).toBe(HTTP_NOT_FOUND);
    const expired = await createInvite(board.id, 'viewer');
    await database.query(
      "UPDATE board_invites SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id = $1",
      [expired.invite.id],
    );
    expect(
      (
        await request('/invites/preview', 'viewer', {
          method: 'POST',
          body: { token: expired.token },
        })
      ).status,
    ).toBe(HTTP_GONE);
    expect(
      (
        await request('/invites/accept', 'viewer', {
          method: 'POST',
          body: { token: expired.token },
        })
      ).status,
    ).toBe(HTTP_GONE);
    const active = await createInvite(board.id, 'viewer');
    const states = boardInviteListResponseSchema.parse(
      await (await request(`/boards/${board.id}/invites`, 'owner')).json(),
    ).data;
    expect(new Map(states.map((invite) => [invite.id, invite.status]))).toEqual(
      new Map([
        [revoked.invite.id, 'revoked'],
        [expired.invite.id, 'expired'],
        [active.invite.id, 'active'],
      ]),
    );
    const archived = await request(`/boards/${board.id}/archive`, 'owner', {
      method: 'POST',
      body: { expectedVersion: board.metadataVersion },
    });
    expect(archived.status).toBe(HTTP_OK);
    expect(
      (
        await request('/invites/preview', 'viewer', {
          method: 'POST',
          body: { token: active.token },
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    expect((await request(`/boards/${board.id}/invites`, 'owner')).status).toBe(HTTP_CONFLICT);
    expect(
      (
        await request(`/boards/${board.id}/invites`, 'owner', {
          method: 'POST',
          key: randomUUID(),
          body: { role: 'viewer' },
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    expect(
      (
        await request(`/boards/${board.id}/invites/${active.invite.id}`, 'owner', {
          method: 'DELETE',
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    expect(
      (
        await request('/invites/accept', 'viewer', {
          method: 'POST',
          body: { token: active.token },
        })
      ).status,
    ).toBe(HTTP_CONFLICT);
    const untouched = (await database.query('SELECT accepted_by FROM board_invites WHERE id = $1', [
      active.invite.id,
    ])) as { accepted_by: string | null }[];
    expect(untouched[0]?.accepted_by).toBeNull();
    expect(
      (
        await request(`/boards/${board.id}/restore`, 'owner', {
          method: 'POST',
          body: { expectedVersion: board.metadataVersion + 1 },
        })
      ).status,
    ).toBe(HTTP_OK);
    await database.query(
      'ALTER TABLE board_members ADD CONSTRAINT deny_p308_member CHECK (false) NOT VALID',
    );
    try {
      const failed = await request('/invites/accept', 'viewer', {
        method: 'POST',
        body: { token: active.token },
      });
      expect(failed.status).toBe(HTTP_UNAVAILABLE);
      const state = (await database.query('SELECT accepted_by FROM board_invites WHERE id = $1', [
        active.invite.id,
      ])) as { accepted_by: string | null }[];
      expect(state[0]?.accepted_by).toBeNull();
    } finally {
      await database.query('ALTER TABLE board_members DROP CONSTRAINT deny_p308_member');
    }
    expect(
      (
        await request('/invites/accept', 'viewer', {
          method: 'POST',
          body: { token: active.token },
        })
      ).status,
    ).toBe(HTTP_OK);
    const before = (await database.query(
      'SELECT count(*)::integer AS count FROM board_invites WHERE board_id = $1',
      [board.id],
    )) as { count: number }[];
    const failedKey = randomUUID();
    await database.query(
      'ALTER TABLE api_idempotency ADD CONSTRAINT deny_p308_receipt CHECK (false) NOT VALID',
    );
    try {
      const failedCreate = await request(`/boards/${board.id}/invites`, 'owner', {
        method: 'POST',
        key: failedKey,
        body: { role: 'editor' },
      });
      expect(failedCreate.status).toBe(HTTP_UNAVAILABLE);
      const after = (await database.query(
        'SELECT count(*)::integer AS count FROM board_invites WHERE board_id = $1',
        [board.id],
      )) as { count: number }[];
      expect(after[0]?.count).toBe(before[0]?.count);
      expect(
        (await database.query('SELECT key FROM api_idempotency WHERE key = $1', [
          failedKey,
        ])) as unknown[],
      ).toHaveLength(0);
    } finally {
      await database.query('ALTER TABLE api_idempotency DROP CONSTRAINT deny_p308_receipt');
    }
  });

  it('serializes two signed-in users racing for one invite with a deterministic barrier', async () => {
    const board = await createBoard('A19 race');
    const { token, invite } = await createInvite(board.id, 'viewer');
    const actor = application.get<RequestActor>(AUTH_REQUEST_ACTOR);
    let arrivals = 0;
    let release!: () => void;
    let bothArrived!: () => void;
    const reached = new Promise<void>((resolve) => {
      bothArrived = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new InviteService(
      new PostgresInvitePersistence(database, ORIGIN, async () => {
        arrivals += 1;
        if (arrivals === COMPETING_ACCEPTORS) bothArrived();
        await barrier;
      }),
      new BoardPermissionService(new PostgresBoardAuthorityReader(database)),
    );
    const editorId = (await actor.require({ cookie: users.get('editor')!.cookie })).user.id;
    const viewerId = (await actor.require({ cookie: users.get('viewer')!.cookie })).user.id;
    const results = [service.accept(editorId, token), service.accept(viewerId, token)];
    await reached;
    release();
    const settled = await Promise.allSettled(results);
    const winner = settled.find((result) => result.status === 'fulfilled');
    const loser = settled.find((result) => result.status === 'rejected');
    expect(winner?.status).toBe('fulfilled');
    if (winner?.status === 'fulfilled') {
      expect(winner.value).toEqual({ boardId: board.id, effectiveRole: 'viewer' });
    }
    expect(loser).toMatchObject({
      status: 'rejected',
      reason: { code: ERROR_CODES.INVITE_EXHAUSTED },
    });
    const acceptedBy = (await database.query(
      'SELECT accepted_by FROM board_invites WHERE id = $1',
      [invite.id],
    )) as { accepted_by: string }[];
    expect([editorId, viewerId].includes(acceptedBy[0]!.accepted_by)).toBe(true);
    const members = (await database.query('SELECT user_id FROM board_members WHERE board_id = $1', [
      board.id,
    ])) as { user_id: string }[];
    expect(members.map((member) => member.user_id)).toEqual([acceptedBy[0]!.accepted_by]);
    expect((await service.accept(acceptedBy[0]!.accepted_by, token)).effectiveRole).toBe('viewer');
  });
});
