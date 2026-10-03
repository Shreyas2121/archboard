import {
  deleteCommentSchema,
  threadCreateResponseSchema,
  importBoardSchema,
  importBoardResponseSchema,
  createCheckpointSchema,
  checkpointDetailResponseSchema,
  boardSummaryResponseSchema,
} from '@archboard/contracts';
import { z } from 'zod';

import { createOpenApiDocument } from './openapi.js';

const anchorVariantCount = 3;

describe('Phase 6 discussion OpenAPI', () => {
  it('documents board creation as a strict summary while retaining board detail reads', () => {
    const document = createOpenApiDocument();
    expect(document.components.schemas.BoardSummaryResponse).toEqual(
      z.toJSONSchema(boardSummaryResponseSchema, { io: 'output' }),
    );
    const create = document.paths['/api/v1/boards']?.post;
    const read = document.paths['/api/v1/boards/{id}']?.get;
    expect(JSON.stringify(create)).toContain('#/components/schemas/BoardSummaryResponse');
    expect(JSON.stringify(read)).toContain('#/components/schemas/BoardDetailResponse');
  });
  it('documents immutable board-scoped checkpoint reads, capture and restore creation only', () => {
    const document = createOpenApiDocument();
    expect(document.components.schemas.CreateCheckpointRequest).toEqual(
      z.toJSONSchema(createCheckpointSchema, { io: 'input' }),
    );
    expect(document.components.schemas.CheckpointDetailResponse).toEqual(
      z.toJSONSchema(checkpointDetailResponseSchema, { io: 'output' }),
    );
    expect(Object.keys(document.paths['/api/v1/boards/{id}/checkpoints'] ?? {})).toEqual([
      'get',
      'post',
    ]);
    expect(
      Object.keys(document.paths['/api/v1/boards/{id}/checkpoints/{checkpointId}'] ?? {}),
    ).toEqual(['get']);
    expect(
      Object.keys(document.paths['/api/v1/boards/{id}/checkpoints/{checkpointId}/duplicate'] ?? {}),
    ).toEqual(['post']);
  });
  it('documents strict import DTOs and an idempotent private creation route', () => {
    const document = createOpenApiDocument();
    expect(document.components.schemas.ImportBoardRequest).toEqual(
      z.toJSONSchema(importBoardSchema, { io: 'input' }),
    );
    expect(document.components.schemas.ImportBoardResponse).toEqual(
      z.toJSONSchema(importBoardResponseSchema, { io: 'output' }),
    );
    const route = document.paths['/api/v1/imports'];
    expect(Object.keys(route ?? {})).toEqual(['post']);
    expect(JSON.stringify(route)).toContain('Idempotency-Key');
  });
  it('maps shared discussion DTOs and advertises only implemented discussion operations', () => {
    const document = createOpenApiDocument();
    expect(document.components.schemas.DeleteCommentRequest).toEqual(
      z.toJSONSchema(deleteCommentSchema, { io: 'input' }),
    );
    expect(document.components.schemas.ThreadCreateResponse).toEqual(
      z.toJSONSchema(threadCreateResponseSchema, { io: 'output' }),
    );
    expect(
      document.components.schemas.ThreadAnchor?.oneOf ??
        document.components.schemas.ThreadAnchor?.anyOf,
    ).toHaveLength(anchorVariantCount);
    expect(Object.keys(document.paths['/api/v1/boards/{id}/threads'] ?? {})).toEqual([
      'get',
      'post',
    ]);
    expect(
      Object.keys(document.paths['/api/v1/boards/{id}/threads/{threadId}/comments'] ?? {}),
    ).toEqual(['get', 'post']);
    expect(Object.keys(document.paths['/api/v1/boards/{id}/comments/{commentId}'] ?? {})).toEqual([
      'patch',
      'delete',
    ]);
    expect(Object.keys(document.paths['/api/v1/boards/{id}/threads/{threadId}'] ?? {})).toEqual([
      'patch',
    ]);
    expect(document.paths['/api/v1/boards/{id}/members']).toBeDefined();
    expect(document.paths['/api/v1/invites/accept']).toBeDefined();
  });
});
