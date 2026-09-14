import type { BOARD_ROLES } from '@archboard/contracts';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

type InviteRole = (typeof BOARD_ROLES)['EDITOR' | 'VIEWER'];

@Entity({ name: 'board_invites' })
@Index('IDX_board_invites_board', ['boardId'])
export class BoardInviteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'token_hash', type: 'bytea', unique: true })
  tokenHash!: Buffer;

  @Column({ type: 'text' })
  role!: InviteRole;

  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'accepted_by', type: 'text', nullable: true })
  acceptedBy!: string | null;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
