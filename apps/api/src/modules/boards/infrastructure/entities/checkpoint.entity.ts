import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'checkpoints' })
@Index('IDX_checkpoints_board_created_id', ['boardId', 'createdAt', 'id'])
export class CheckpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  @Column({ name: 'through_seq', type: 'bigint' })
  throughSeq!: string;

  @Column({ name: 'schema_version', type: 'integer' })
  schemaVersion!: number;

  @Column({ name: 'update_bytes', type: 'bytea' })
  updateBytes!: Buffer;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
