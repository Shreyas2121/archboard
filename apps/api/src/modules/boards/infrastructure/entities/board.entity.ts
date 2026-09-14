import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'boards' })
@Index('IDX_boards_active_owner_content_updated', ['ownerUserId', 'contentUpdatedAt'], {
  where: '"archived_at" IS NULL',
})
export class BoardEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_user_id', type: 'text' })
  ownerUserId!: string;

  @Column({ type: 'text' })
  title!: string;

  @Column({ type: 'text', default: '' })
  description!: string;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @Column({ name: 'metadata_version', type: 'integer', default: 1 })
  metadataVersion!: number;

  @Column({ name: 'latest_seq', type: 'bigint', default: '0' })
  latestSeq!: string;

  @Column({ name: 'content_updated_at', type: 'timestamptz' })
  contentUpdatedAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
