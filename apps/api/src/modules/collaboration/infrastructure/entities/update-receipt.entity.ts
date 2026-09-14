import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'update_receipts' })
export class UpdateReceiptEntity {
  @PrimaryColumn({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @PrimaryColumn({ name: 'update_id', type: 'uuid' })
  updateId!: string;

  @Column({ name: 'actor_user_id', type: 'text' })
  actorUserId!: string;

  @Column({ name: 'payload_hash', type: 'bytea' })
  payloadHash!: Buffer;

  @Column({ name: 'seq', type: 'bigint' })
  sequence!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
