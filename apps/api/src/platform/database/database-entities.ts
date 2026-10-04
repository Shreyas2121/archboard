import {
  ApiIdempotencyEntity,
  BoardEntity,
  BoardInviteEntity,
  BoardMemberEntity,
  CheckpointEntity,
  CommentEntity,
  CommentThreadEntity,
} from '../../modules/boards/infrastructure/entities/index.js';
import {
  BoardSnapshotEntity,
  BoardUpdateEntity,
  UpdateReceiptEntity,
} from '../../modules/collaboration/infrastructure/entities/index.js';

import { AI_ENTITIES } from '../../modules/ai/infrastructure/persistence/entities.js';

export const DATABASE_ENTITIES = [
  ...AI_ENTITIES,
  BoardEntity,
  BoardMemberEntity,
  BoardInviteEntity,
  BoardSnapshotEntity,
  BoardUpdateEntity,
  UpdateReceiptEntity,
  CheckpointEntity,
  CommentThreadEntity,
  CommentEntity,
  ApiIdempotencyEntity,
] as const;
