import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'board_updates' })
@Index('UQ_board_updates_board_update', ['boardId', 'updateId'], { unique: true })
@Index('IDX_board_updates_board_seq', ['boardId', 'sequence'])
export class BoardUpdateEntity {
  @PrimaryColumn({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @PrimaryColumn({ name: 'seq', type: 'bigint' })
  sequence!: string;

  @Column({ name: 'update_id', type: 'uuid' })
  updateId!: string;

  @Column({ name: 'actor_user_id', type: 'text' })
  actorUserId!: string;

  @Column({ name: 'update_bytes', type: 'bytea' })
  updateBytes!: Buffer;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
