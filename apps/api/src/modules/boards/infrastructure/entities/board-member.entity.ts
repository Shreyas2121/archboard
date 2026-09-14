import type { BOARD_ROLES } from '@archboard/contracts';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

type MemberRole = (typeof BOARD_ROLES)['EDITOR' | 'VIEWER'];

@Entity({ name: 'board_members' })
@Index('IDX_board_members_user', ['userId'])
export class BoardMemberEntity {
  @PrimaryColumn({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @PrimaryColumn({ name: 'user_id', type: 'text' })
  userId!: string;

  @Column({ type: 'text' })
  role!: MemberRole;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
