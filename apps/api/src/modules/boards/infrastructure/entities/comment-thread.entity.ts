import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'comment_threads' })
@Index('IDX_comment_threads_board_created_id', ['boardId', 'createdAt', 'id'])
export class CommentThreadEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'board_id', type: 'uuid' })
  boardId!: string;

  @Column({ type: 'jsonb' })
  anchor!: unknown;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by', type: 'text', nullable: true })
  resolvedBy!: string | null;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ name: 'created_by', type: 'text' })
  createdBy!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
