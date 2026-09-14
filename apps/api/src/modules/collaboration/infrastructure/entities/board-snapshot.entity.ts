import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'board_snapshots' })
export class BoardSnapshotEntity {
  @PrimaryColumn({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ name: 'schema_version', type: 'integer' })
  schemaVersion!: number;

  @Column({ name: 'through_seq', type: 'bigint' })
  throughSeq!: string;

  @Column({ name: 'update_bytes', type: 'bytea' })
  updateBytes!: Buffer;

  @Column({ name: 'byte_length', type: 'integer' })
  byteLength!: number;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
