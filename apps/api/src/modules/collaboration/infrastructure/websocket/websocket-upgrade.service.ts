import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

import {
  CLIENT_EVENT_NAMES,
  ERROR_CODES,
  MAX_WS_FRAME_BYTES,
  SERVER_EVENT_NAMES,
  applicationIdSchema,
  clientMessageSchema,
  serverMessageSchema,
} from '@archboard/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';

import { BetterAuthRuntime } from '../../../auth/index.js';
import type { ApiConfig } from '../../../../platform/config/index.js';
import { WS_HANDSHAKE_TIMEOUT_MS } from '../../../../platform/config/index.js';
import { WEBSOCKET_API_CONFIG } from './websocket.tokens.js';

const BOARD_WEBSOCKET_PATH = /^\/ws\/boards\/([^/]+)$/;
const HTTP_STATUS_TEXT = {
  BAD_REQUEST: 'Bad Request',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  NOT_FOUND: 'Not Found',
  REQUEST_TIMEOUT: 'Request Timeout',
  INTERNAL_SERVER_ERROR: 'Internal Server Error',
} as const;
const CLOSE_POLICY_VIOLATION = 1008;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_INTERNAL_SERVER_ERROR = 500;

class HandshakeTimeoutError extends Error {}

@Injectable()
export class WebSocketUpgradeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly websocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_FRAME_BYTES,
  });
  private httpServer: HttpServer | undefined;

  public constructor(
    @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(BetterAuthRuntime) private readonly authRuntime: BetterAuthRuntime,
    @Inject(WEBSOCKET_API_CONFIG) private readonly config: ApiConfig,
  ) {}

  public onApplicationBootstrap(): void {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.httpServer = httpServer;
    httpServer.on('upgrade', this.handleUpgrade);
  }

  public async onApplicationShutdown(): Promise<void> {
    this.httpServer?.off('upgrade', this.handleUpgrade);
    for (const client of this.websocketServer.clients) client.terminate();
    await new Promise<void>((resolve) => this.websocketServer.close(() => resolve()));
  }

  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    void this.authenticateUpgrade(request, socket, head).catch(() => {
      this.rejectUpgrade(
        socket,
        HTTP_INTERNAL_SERVER_ERROR,
        HTTP_STATUS_TEXT.INTERNAL_SERVER_ERROR,
      );
    });
  };

  private async authenticateUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const pathname = new URL(request.url ?? '/', this.config.publicApiOrigin).pathname;
    const pathMatch = BOARD_WEBSOCKET_PATH.exec(pathname);
    if (pathMatch === null) {
      this.rejectUpgrade(socket, HTTP_NOT_FOUND, HTTP_STATUS_TEXT.NOT_FOUND);
      return;
    }
    if (!applicationIdSchema.safeParse(pathMatch[1]).success) {
      this.rejectUpgrade(socket, HTTP_BAD_REQUEST, HTTP_STATUS_TEXT.BAD_REQUEST);
      return;
    }
    if (
      typeof request.headers.origin !== 'string' ||
      !this.config.allowedWebOrigins.includes(request.headers.origin)
    ) {
      this.rejectUpgrade(socket, HTTP_FORBIDDEN, HTTP_STATUS_TEXT.FORBIDDEN);
      return;
    }

    let session: Awaited<ReturnType<typeof this.authRuntime.auth.api.getSession>>;
    try {
      session = await this.getSessionWithinHandshakeLimit(request);
    } catch (error) {
      if (error instanceof HandshakeTimeoutError) {
        this.rejectUpgrade(socket, HTTP_REQUEST_TIMEOUT, HTTP_STATUS_TEXT.REQUEST_TIMEOUT);
        return;
      }
      this.rejectUpgrade(socket, HTTP_UNAUTHORIZED, HTTP_STATUS_TEXT.UNAUTHORIZED);
      return;
    }
    if (session === null) {
      this.rejectUpgrade(socket, HTTP_UNAUTHORIZED, HTTP_STATUS_TEXT.UNAUTHORIZED);
      return;
    }

    this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      this.acceptAuthenticatedConnection(websocket);
    });
  }

  private async getSessionWithinHandshakeLimit(request: IncomingMessage) {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        this.authRuntime.auth.api.getSession({ headers: fromNodeHeaders(request.headers) }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new HandshakeTimeoutError()), WS_HANDSHAKE_TIMEOUT_MS);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private acceptAuthenticatedConnection(websocket: WebSocket): void {
    let initialized = false;
    websocket.on('error', () => undefined);
    websocket.on('message', (rawData, isBinary) => {
      const parsed = this.parseClientMessage(rawData, isBinary);
      if (parsed === undefined || (!initialized && parsed.event !== CLIENT_EVENT_NAMES.HELLO)) {
        websocket.close(CLOSE_POLICY_VIOLATION, 'Invalid client envelope');
        return;
      }
      if (!initialized) {
        initialized = true;
        const unavailable = serverMessageSchema.parse({
          event: SERVER_EVENT_NAMES.ERROR,
          data: {
            code: ERROR_CODES.SERVER_BUSY,
            message: 'Room synchronization is not available in the authentication spike.',
            retryable: true,
          },
        });
        websocket.send(JSON.stringify(unavailable));
      }
    });
  }

  private parseClientMessage(rawData: RawData, isBinary: boolean) {
    if (isBinary) return undefined;
    try {
      return clientMessageSchema.safeParse(JSON.parse(rawData.toString())).data;
    } catch {
      return undefined;
    }
  }

  private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
    if (socket.destroyed) return;
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}
