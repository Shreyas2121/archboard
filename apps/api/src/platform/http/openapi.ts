import {
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardSummaryResponseSchema,
  boardIdPathSchema,
  boardInviteListResponseSchema,
  boardInviteResponseSchema,
  boardListQuerySchema,
  boardListResponseSchema,
  boardMemberResponseSchema,
  boardMembersResponseSchema,
  boardVersionRequestSchema,
  changeMemberRoleSchema,
  createTemplateBoardSchema,
  createInviteSchema,
  currentUserResponseSchema,
  duplicateBoardSchema,
  importBoardSchema,
  importBoardResponseSchema,
  checkpointPathSchema,
  checkpointListQuerySchema,
  checkpointListResponseSchema,
  checkpointSummaryResponseSchema,
  checkpointDetailResponseSchema,
  createCheckpointSchema,
  restoreCheckpointSchema,
  restoreCheckpointResponseSchema,
  inviteAcceptanceResponseSchema,
  inviteListQuerySchema,
  invitePathSchema,
  invitePreviewResponseSchema,
  inviteTokenRequestSchema,
  memberPathSchema,
  patchBoardSchema,
  idempotencyKeySchema,
  threadAnchorSchema,
  threadListResponseSchema,
  commentListResponseSchema,
  threadCreateResponseSchema,
  commentResponseSchema,
  threadResponseSchema,
  createThreadSchema,
  createCommentSchema,
  editCommentSchema,
  deleteCommentSchema,
  resolveThreadSchema,
  threadPathSchema,
  threadListQuerySchema,
  commentListQuerySchema,
  commentPathSchema,
} from '@archboard/contracts';
import { z } from 'zod';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_GONE = 410;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_RATE_LIMITED = 429;
const HTTP_UNAVAILABLE = 503;

const schemas = {
  CheckpointListResponse: checkpointListResponseSchema,
  CheckpointSummaryResponse: checkpointSummaryResponseSchema,
  CheckpointDetailResponse: checkpointDetailResponseSchema,
  CreateCheckpointRequest: createCheckpointSchema,
  RestoreCheckpointRequest: restoreCheckpointSchema,
  RestoreCheckpointResponse: restoreCheckpointResponseSchema,
  ApiError: apiErrorEnvelopeSchema,
  CurrentUserResponse: currentUserResponseSchema,
  BoardDetailResponse: boardDetailResponseSchema,
  BoardSummaryResponse: boardSummaryResponseSchema,
  BoardListResponse: boardListResponseSchema,
  BoardMembersResponse: boardMembersResponseSchema,
  BoardMemberResponse: boardMemberResponseSchema,
  BoardInviteResponse: boardInviteResponseSchema,
  BoardInviteListResponse: boardInviteListResponseSchema,
  InvitePreviewResponse: invitePreviewResponseSchema,
  InviteAcceptanceResponse: inviteAcceptanceResponseSchema,
  CreateBoardRequest: createTemplateBoardSchema,
  PatchBoardRequest: patchBoardSchema,
  BoardVersionRequest: boardVersionRequestSchema,
  DuplicateBoardRequest: duplicateBoardSchema,
  ImportBoardRequest: importBoardSchema,
  ImportBoardResponse: importBoardResponseSchema,
  ChangeMemberRoleRequest: changeMemberRoleSchema,
  CreateInviteRequest: createInviteSchema,
  InviteTokenRequest: inviteTokenRequestSchema,
  // Shared discussion components cover reads, creation, and versioned moderation.
  ThreadAnchor: threadAnchorSchema,
  ThreadListResponse: threadListResponseSchema,
  CommentListResponse: commentListResponseSchema,
  ThreadCreateResponse: threadCreateResponseSchema,
  CommentResponse: commentResponseSchema,
  ThreadResponse: threadResponseSchema,
  CreateThreadRequest: createThreadSchema,
  CreateCommentRequest: createCommentSchema,
  EditCommentRequest: editCommentSchema,
  DeleteCommentRequest: deleteCommentSchema,
  ResolveThreadRequest: resolveThreadSchema,
} as const;

type SchemaName = keyof typeof schemas;
type ParameterSchema =
  | typeof checkpointPathSchema
  | typeof checkpointListQuerySchema
  | typeof boardIdPathSchema
  | typeof memberPathSchema
  | typeof invitePathSchema
  | typeof boardListQuerySchema
  | typeof inviteListQuerySchema;
type DiscussionParameterSchema =
  | typeof threadPathSchema
  | typeof threadListQuerySchema
  | typeof commentListQuerySchema
  | typeof commentPathSchema;

interface RouteSpec {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  summary: string;
  response?: SchemaName;
  request?: SchemaName;
  pathSchema?: ParameterSchema | DiscussionParameterSchema;
  querySchema?: ParameterSchema | DiscussionParameterSchema;
  idempotent?: boolean;
  success?: number;
  errors?: readonly number[];
}

const routes: readonly RouteSpec[] = [
  {
    method: 'get',
    path: '/api/v1/boards/{id}/checkpoints',
    summary: 'List immutable checkpoint metadata, newest first, for current readers',
    pathSchema: boardIdPathSchema,
    querySchema: checkpointListQuerySchema,
    response: 'CheckpointListResponse',
    errors: [HTTP_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/api/v1/boards/{id}/checkpoints/{checkpointId}',
    summary: 'Read a board-scoped checkpoint projection; archived readers allowed',
    pathSchema: checkpointPathSchema,
    response: 'CheckpointDetailResponse',
    errors: [HTTP_NOT_FOUND, HTTP_UNAVAILABLE],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/checkpoints',
    summary:
      'Capture committed graph at expectedSeq; current active owner/editor, 100 checkpoint cap',
    pathSchema: boardIdPathSchema,
    request: 'CreateCheckpointRequest',
    response: 'CheckpointSummaryResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT, HTTP_PAYLOAD_TOO_LARGE],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/checkpoints/{checkpointId}/duplicate',
    summary: 'Restore checkpoint as a fresh private board owned by the current reader',
    pathSchema: checkpointPathSchema,
    request: 'RestoreCheckpointRequest',
    response: 'RestoreCheckpointResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_NOT_FOUND, HTTP_CONFLICT, HTTP_RATE_LIMITED],
  },
  {
    method: 'patch',
    path: '/api/v1/boards/{id}/comments/{commentId}',
    summary:
      'Edit own message or moderate as owner; stale/deleted versions conflict, identical body is unchanged',
    pathSchema: commentPathSchema,
    request: 'EditCommentRequest',
    response: 'CommentResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'delete',
    path: '/api/v1/boards/{id}/comments/{commentId}',
    summary:
      'Retain deletion marker (200); current-version deleted state is unchanged, stale version conflicts',
    pathSchema: commentPathSchema,
    request: 'DeleteCommentRequest',
    response: 'CommentResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'patch',
    path: '/api/v1/boards/{id}/threads/{threadId}',
    summary:
      'Resolve/reopen thread; current-version unchanged state preserves metadata, stale version conflicts',
    pathSchema: threadPathSchema,
    request: 'ResolveThreadRequest',
    response: 'ThreadResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'get',
    path: '/api/v1/boards/{id}/threads',
    summary: 'List discussion threads (createdAt/id descending)',
    pathSchema: boardIdPathSchema,
    querySchema: threadListQuerySchema,
    response: 'ThreadListResponse',
    errors: [HTTP_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/api/v1/boards/{id}/threads/{threadId}/comments',
    summary: 'List discussion messages (createdAt/id ascending)',
    pathSchema: threadPathSchema,
    querySchema: commentListQuerySchema,
    response: 'CommentListResponse',
    errors: [HTTP_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/threads',
    summary: 'Create thread and first message atomically',
    pathSchema: boardIdPathSchema,
    request: 'CreateThreadRequest',
    response: 'ThreadCreateResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/threads/{threadId}/comments',
    summary: 'Reply to discussion thread',
    pathSchema: threadPathSchema,
    request: 'CreateCommentRequest',
    response: 'CommentResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  { method: 'get', path: '/api/v1/me', summary: 'Current user', response: 'CurrentUserResponse' },
  {
    method: 'get',
    path: '/api/v1/boards',
    summary: 'List accessible boards',
    response: 'BoardListResponse',
    querySchema: boardListQuerySchema,
  },
  {
    method: 'post',
    path: '/api/v1/boards',
    summary: 'Create board',
    request: 'CreateBoardRequest',
    response: 'BoardSummaryResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_CONFLICT],
  },
  {
    method: 'get',
    path: '/api/v1/boards/{id}',
    summary: 'Read board',
    pathSchema: boardIdPathSchema,
    response: 'BoardDetailResponse',
    errors: [HTTP_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/api/v1/boards/{id}',
    summary: 'Update board metadata',
    pathSchema: boardIdPathSchema,
    request: 'PatchBoardRequest',
    response: 'BoardDetailResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/archive',
    summary: 'Archive board',
    pathSchema: boardIdPathSchema,
    request: 'BoardVersionRequest',
    response: 'BoardDetailResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/restore',
    summary: 'Restore board',
    pathSchema: boardIdPathSchema,
    request: 'BoardVersionRequest',
    response: 'BoardDetailResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/duplicate',
    summary: 'Duplicate board',
    pathSchema: boardIdPathSchema,
    request: 'DuplicateBoardRequest',
    response: 'BoardDetailResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'post',
    path: '/api/v1/imports',
    summary: 'Import a validated portable graph as a new private board (5 MiB file limit)',
    request: 'ImportBoardRequest',
    response: 'ImportBoardResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_CONFLICT, HTTP_PAYLOAD_TOO_LARGE, HTTP_RATE_LIMITED],
  },
  {
    method: 'get',
    path: '/api/v1/boards/{id}/members',
    summary: 'List members',
    pathSchema: boardIdPathSchema,
    response: 'BoardMembersResponse',
    errors: [HTTP_NOT_FOUND],
  },
  {
    method: 'patch',
    path: '/api/v1/boards/{id}/members/{userId}',
    summary: 'Change member role',
    pathSchema: memberPathSchema,
    request: 'ChangeMemberRoleRequest',
    response: 'BoardMemberResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'delete',
    path: '/api/v1/boards/{id}/members/{userId}',
    summary: 'Remove member or leave board',
    pathSchema: memberPathSchema,
    success: HTTP_NO_CONTENT,
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'get',
    path: '/api/v1/boards/{id}/invites',
    summary: 'List invitations',
    pathSchema: boardIdPathSchema,
    querySchema: inviteListQuerySchema,
    response: 'BoardInviteListResponse',
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'post',
    path: '/api/v1/boards/{id}/invites',
    summary: 'Create invitation',
    pathSchema: boardIdPathSchema,
    request: 'CreateInviteRequest',
    response: 'BoardInviteResponse',
    idempotent: true,
    success: HTTP_CREATED,
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT],
  },
  {
    method: 'delete',
    path: '/api/v1/boards/{id}/invites/{inviteId}',
    summary: 'Revoke invitation',
    pathSchema: invitePathSchema,
    success: HTTP_NO_CONTENT,
    errors: [HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_CONFLICT, HTTP_GONE],
  },
  {
    method: 'post',
    path: '/api/v1/invites/preview',
    summary: 'Preview invitation',
    request: 'InviteTokenRequest',
    response: 'InvitePreviewResponse',
    errors: [HTTP_NOT_FOUND, HTTP_CONFLICT, HTTP_GONE],
  },
  {
    method: 'post',
    path: '/api/v1/invites/accept',
    summary: 'Accept invitation',
    request: 'InviteTokenRequest',
    response: 'InviteAcceptanceResponse',
    errors: [HTTP_NOT_FOUND, HTTP_CONFLICT, HTTP_GONE],
  },
];

function parameterEntries(
  schema: ParameterSchema | DiscussionParameterSchema,
  location: 'path' | 'query',
) {
  return Object.entries(schema.shape).map(([name, field]) => ({
    name,
    in: location,
    required: location === 'path' || (!field.isOptional() && !field.safeParse(undefined).success),
    schema: z.toJSONSchema(field, { io: 'input' }),
  }));
}

function response(status: number, schema?: SchemaName) {
  return {
    description:
      status === HTTP_NO_CONTENT
        ? 'No content'
        : status >= HTTP_BAD_REQUEST
          ? 'API error'
          : 'Success',
    ...(status === HTTP_NO_CONTENT
      ? {}
      : {
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/${status >= HTTP_BAD_REQUEST ? 'ApiError' : schema}`,
              },
            },
          },
        }),
  };
}

export function createOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const success = route.success ?? HTTP_OK;
    const errors = [
      ...new Set([
        HTTP_BAD_REQUEST,
        HTTP_UNAUTHORIZED,
        HTTP_PAYLOAD_TOO_LARGE,
        HTTP_RATE_LIMITED,
        HTTP_UNAVAILABLE,
        ...(route.errors ?? []),
      ]),
    ];
    const parameters = [
      ...(route.pathSchema ? parameterEntries(route.pathSchema, 'path') : []),
      ...(route.querySchema ? parameterEntries(route.querySchema, 'query') : []),
      ...(route.idempotent
        ? [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              schema: z.toJSONSchema(idempotencyKeySchema, { io: 'input' }),
            },
          ]
        : []),
    ];
    const operation = {
      operationId: `${route.method}_${route.path.replaceAll(/[^a-zA-Z0-9]+/g, '_')}`,
      summary: route.summary,
      security: [{ sessionCookie: [] }],
      ...(parameters.length ? { parameters } : {}),
      ...(route.request
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${route.request}` } },
              },
            },
          }
        : {}),
      responses: Object.fromEntries([
        [String(success), response(success, route.response)],
        ...errors.map((status) => [String(status), response(status)]),
      ]),
    };
    (paths[route.path] ??= {})[route.method] = operation;
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Archboard API', version: '1.0.0' },
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' },
      },
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { io: name.endsWith('Request') ? 'input' : 'output' }),
        ]),
      ),
    },
  };
}
