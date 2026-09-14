import { readFile } from 'node:fs/promises';

import { BOARD_ROLES } from '@archboard/contracts';
import type { MigrationInterface, QueryRunner } from 'typeorm';

const AUTH_SCHEMA_URL = new URL('../platform/database/auth-schema.sql', import.meta.url);

export class InitialDatabaseFoundation1789300000000 implements MigrationInterface {
  public readonly name = 'InitialDatabaseFoundation1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(await readFile(AUTH_SCHEMA_URL, 'utf8'));
    await queryRunner.query(`
      CREATE TABLE "boards" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
        "title" text NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "archived_at" timestamptz,
        "metadata_version" integer NOT NULL DEFAULT 1 CHECK ("metadata_version" > 0),
        "latest_seq" bigint NOT NULL DEFAULT 0 CHECK ("latest_seq" >= 0),
        "content_updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX "IDX_boards_active_owner_content_updated"
        ON "boards" ("owner_user_id", "content_updated_at" DESC)
        WHERE "archived_at" IS NULL;

      CREATE TABLE "board_members" (
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "role" text NOT NULL CHECK ("role" IN ('${BOARD_ROLES.EDITOR}', '${BOARD_ROLES.VIEWER}')),
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("board_id", "user_id")
      );
      CREATE INDEX "IDX_board_members_user" ON "board_members" ("user_id");

      CREATE TABLE "board_invites" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "token_hash" bytea NOT NULL UNIQUE,
        "role" text NOT NULL CHECK ("role" IN ('${BOARD_ROLES.EDITOR}', '${BOARD_ROLES.VIEWER}')),
        "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "accepted_by" text REFERENCES "user"("id") ON DELETE SET NULL,
        "accepted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (("accepted_by" IS NULL) = ("accepted_at" IS NULL))
      );
      CREATE INDEX "IDX_board_invites_board" ON "board_invites" ("board_id");

      CREATE TABLE "board_snapshots" (
        "board_id" uuid PRIMARY KEY REFERENCES "boards"("id") ON DELETE CASCADE,
        "schema_version" integer NOT NULL CHECK ("schema_version" > 0),
        "through_seq" bigint NOT NULL CHECK ("through_seq" >= 0),
        "update_bytes" bytea NOT NULL,
        "byte_length" integer NOT NULL CHECK ("byte_length" >= 0),
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (octet_length("update_bytes") = "byte_length")
      );

      CREATE TABLE "board_updates" (
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "seq" bigint NOT NULL CHECK ("seq" > 0),
        "update_id" uuid NOT NULL,
        "actor_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
        "update_bytes" bytea NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("board_id", "seq"),
        CONSTRAINT "UQ_board_updates_board_update" UNIQUE ("board_id", "update_id")
      );
      CREATE INDEX "IDX_board_updates_board_seq" ON "board_updates" ("board_id", "seq");

      CREATE TABLE "update_receipts" (
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "update_id" uuid NOT NULL,
        "actor_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
        "payload_hash" bytea NOT NULL,
        "seq" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("board_id", "update_id"),
        FOREIGN KEY ("board_id", "update_id")
          REFERENCES "board_updates"("board_id", "update_id") ON DELETE CASCADE,
        FOREIGN KEY ("board_id", "seq")
          REFERENCES "board_updates"("board_id", "seq") ON DELETE CASCADE
      );

      CREATE TABLE "checkpoints" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
        "through_seq" bigint NOT NULL CHECK ("through_seq" >= 0),
        "schema_version" integer NOT NULL CHECK ("schema_version" > 0),
        "update_bytes" bytea NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX "IDX_checkpoints_board_created_id"
        ON "checkpoints" ("board_id", "created_at", "id");

      CREATE TABLE "comment_threads" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "board_id" uuid NOT NULL REFERENCES "boards"("id") ON DELETE CASCADE,
        "anchor" jsonb NOT NULL,
        "resolved_at" timestamptz,
        "resolved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
        "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
        "created_by" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (("resolved_by" IS NULL) = ("resolved_at" IS NULL))
      );
      CREATE INDEX "IDX_comment_threads_board_created_id"
        ON "comment_threads" ("board_id", "created_at", "id");

      CREATE TABLE "comments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "thread_id" uuid NOT NULL REFERENCES "comment_threads"("id") ON DELETE CASCADE,
        "author_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
        "body" text NOT NULL,
        "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
        "edited_at" timestamptz,
        "deleted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX "IDX_comments_thread_created_id"
        ON "comments" ("thread_id", "created_at", "id");

      CREATE TABLE "api_idempotency" (
        "actor_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "operation" text NOT NULL,
        "key" uuid NOT NULL,
        "request_hash" bytea NOT NULL,
        "response_status" integer NOT NULL CHECK ("response_status" BETWEEN 100 AND 599),
        "response_json" jsonb NOT NULL,
        "expires_at" timestamptz NOT NULL,
        PRIMARY KEY ("actor_user_id", "operation", "key")
      );
      CREATE INDEX "IDX_api_idempotency_expiry" ON "api_idempotency" ("expires_at");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE "api_idempotency";
      DROP TABLE "comments";
      DROP TABLE "comment_threads";
      DROP TABLE "checkpoints";
      DROP TABLE "update_receipts";
      DROP TABLE "board_updates";
      DROP TABLE "board_snapshots";
      DROP TABLE "board_invites";
      DROP TABLE "board_members";
      DROP TABLE "boards";
      DROP TABLE "verification";
      DROP TABLE "account";
      DROP TABLE "session";
      DROP TABLE "user";
    `);
  }
}
