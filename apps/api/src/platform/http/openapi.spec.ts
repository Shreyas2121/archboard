import { deleteCommentSchema, threadCreateResponseSchema } from '@archboard/contracts';
import { z } from 'zod';

import { createOpenApiDocument } from './openapi.js';

const anchorVariantCount = 3;

describe('Phase 6 planned OpenAPI components', () => {
  it('maps shared versioned DELETE and atomic-create DTOs while keeping unimplemented paths absent', () => {
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
    expect(
      Object.keys(document.paths).some((path) => /\/(threads|comments)(\/|$)/.test(path)),
    ).toBe(false);
    expect(document.paths['/api/v1/boards/{id}/members']).toBeDefined();
    expect(document.paths['/api/v1/invites/accept']).toBeDefined();
  });
});
