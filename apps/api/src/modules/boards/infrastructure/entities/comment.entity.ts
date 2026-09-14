import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'comments' })
@Index('IDX_comments_thread_created_id', ['threadId', 'createdAt', 'id'])
export class CommentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'thread_id', type: 'uuid' })
  threadId!: string;

  @Column({ name: 'author_user_id', type: 'text' })
  authorUserId!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
