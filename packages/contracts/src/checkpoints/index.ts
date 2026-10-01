import { z } from 'zod';

import { userSummarySchema } from '../auth/index.js';
import {
  boardIdPathSchema,
  boardSummaryResponseSchema,
  duplicateBoardSchema,
} from '../boards/index.js';
import { applicationIdSchema, GRAPH_SCHEMA_VERSION } from '../graph/index.js';
import {
  collectionEnvelopeSchema,
  objectEnvelopeSchema,
  utcTimestampSchema,
} from '../http/index.js';
import { MAX_CHECKPOINT_NAME_CHARACTERS } from '../limits/index.js';
import { pageCursorSchema, pageLimitQuerySchema } from '../pagination/index.js';
import { portableGraphProjectionSchema } from '../portability/index.js';
import { serverSequenceSchema } from '../protocol/index.js';

export const checkpointNameSchema = z.string().trim().min(1).max(MAX_CHECKPOINT_NAME_CHARACTERS);
export const checkpointPathSchema = boardIdPathSchema.safeExtend({
  checkpointId: applicationIdSchema,
});
export const checkpointListQuerySchema = z.strictObject({
  cursor: pageCursorSchema.optional(),
  limit: pageLimitQuerySchema,
});
export const createCheckpointSchema = z.strictObject({
  name: checkpointNameSchema,
  expectedSeq: serverSequenceSchema,
});
export const checkpointSummarySchema = z.strictObject({
  id: applicationIdSchema,
  boardId: applicationIdSchema,
  name: checkpointNameSchema,
  createdBy: userSummarySchema,
  createdAt: utcTimestampSchema,
  throughSeq: serverSequenceSchema,
  schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
});
export const checkpointDetailSchema = checkpointSummarySchema.safeExtend({
  graph: portableGraphProjectionSchema,
});
export const checkpointSummaryResponseSchema = objectEnvelopeSchema(checkpointSummarySchema);
export const checkpointDetailResponseSchema = objectEnvelopeSchema(checkpointDetailSchema);
export const checkpointListResponseSchema = collectionEnvelopeSchema(
  checkpointSummarySchema,
  pageCursorSchema,
);
export const restoreCheckpointSchema = duplicateBoardSchema;
export const restoreCheckpointResponseSchema = boardSummaryResponseSchema;
export type CreateCheckpoint = z.infer<typeof createCheckpointSchema>;
export type CheckpointPath = z.infer<typeof checkpointPathSchema>;
export type CheckpointListQuery = z.infer<typeof checkpointListQuerySchema>;
export type CheckpointSummary = z.infer<typeof checkpointSummarySchema>;
export type CheckpointDetail = z.infer<typeof checkpointDetailSchema>;
export type CheckpointSummaryResponse = z.infer<typeof checkpointSummaryResponseSchema>;
export type CheckpointDetailResponse = z.infer<typeof checkpointDetailResponseSchema>;
export type CheckpointListResponse = z.infer<typeof checkpointListResponseSchema>;
export type RestoreCheckpoint = z.infer<typeof restoreCheckpointSchema>;
export type RestoreCheckpointResponse = z.infer<typeof restoreCheckpointResponseSchema>;
