import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';

import { ERROR_CODES } from '@archboard/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { errorEnvelope, requestContext } from './api-boundary.js';

const MAX_REQUEST_TARGET_CHARACTERS = 4_096;
const MAX_QUERY_CHARACTERS = 2_048;
const MAX_QUERY_FIELDS = 32;
const MAX_JSON_BYTES = '64kb';
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_RATE_LIMITED = 429;
const INVITE_WINDOW_MS = 60_000;
const INVITE_REQUEST_LIMIT = 120;
const MAX_TRACKED_CLIENTS = 10_000;
const MILLISECONDS_PER_SECOND = 1_000;

interface InviteWindow {
  count: number;
  resetAt: number;
}

interface ApiRequest extends IncomingMessage {
  path: string;
  originalUrl: string;
  route?: { path?: string };
}

interface ApiResponse extends ServerResponse {
  locals: Record<string, unknown>;
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

export function configureProductHttp(application: NestExpressApplication): void {
  const inviteWindows = new Map<string, InviteWindow>();
  application.use((request: ApiRequest, response: ApiResponse, next: () => void) => {
    if (!request.path.startsWith('/api/v1/') && !request.path.startsWith('/health/')) {
      next();
      return;
    }
    const requestId = randomUUID();
    const context: { requestId: string; actorId?: string; boardId?: string } = { requestId };
    const started = performance.now();
    response.setHeader('x-request-id', requestId);
    response.setHeader('referrer-policy', 'no-referrer');
    response.on('finish', () => {
      const route = request.route?.path;
      console.info(
        JSON.stringify({
          requestId,
          route: typeof route === 'string' ? route : 'unmatched',
          status: response.statusCode,
          durationMs: Math.round(performance.now() - started),
          ...(context?.actorId ? { actorId: context.actorId } : {}),
          ...(context?.boardId ? { boardId: context.boardId } : {}),
          ...(response.locals.errorCode ? { errorCode: response.locals.errorCode } : {}),
        }),
      );
    });
    requestContext.run(context, () => {
      const target = request.originalUrl;
      const query = target.slice(target.indexOf('?') + 1);
      const hasQuery = target.includes('?');
      if (
        target.length > MAX_REQUEST_TARGET_CHARACTERS ||
        (hasQuery &&
          (query.length > MAX_QUERY_CHARACTERS ||
            [...new URLSearchParams(query).keys()].length > MAX_QUERY_FIELDS))
      ) {
        response.locals.errorCode = ERROR_CODES.PAYLOAD_TOO_LARGE;
        response
          .status(HTTP_PAYLOAD_TOO_LARGE)
          .json(errorEnvelope(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Request is too large.'));
        return;
      }
      if (request.path.includes('/invites')) {
        // Use the direct peer address; forwarded headers are untrusted without a configured proxy.
        const client = request.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        let window = inviteWindows.get(client);
        if (window && window.resetAt <= now) {
          inviteWindows.delete(client);
          window = undefined;
        }
        if (!window) {
          if (inviteWindows.size >= MAX_TRACKED_CLIENTS) {
            for (const [key, value] of inviteWindows) {
              if (value.resetAt <= now) inviteWindows.delete(key);
            }
          }
          if (inviteWindows.size >= MAX_TRACKED_CLIENTS) {
            response.locals.errorCode = ERROR_CODES.RATE_LIMITED;
            response
              .status(HTTP_RATE_LIMITED)
              .json(errorEnvelope(ERROR_CODES.RATE_LIMITED, 'Too many requests.'));
            return;
          }
          window = { count: 0, resetAt: now + INVITE_WINDOW_MS };
          inviteWindows.set(client, window);
        }
        if (window.count >= INVITE_REQUEST_LIMIT) {
          response.setHeader(
            'retry-after',
            String(Math.ceil((window.resetAt - now) / MILLISECONDS_PER_SECOND)),
          );
          response.locals.errorCode = ERROR_CODES.RATE_LIMITED;
          response
            .status(HTTP_RATE_LIMITED)
            .json(errorEnvelope(ERROR_CODES.RATE_LIMITED, 'Too many requests.'));
          return;
        }
        window.count += 1;
      }
      next();
    });
  });
  // Better Auth is registered before this parser and receives its original request stream.
  application.useBodyParser('json', { limit: MAX_JSON_BYTES });
}
