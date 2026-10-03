import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';

import { HELLO_TIMEOUT_MS, applicationIdSchema } from '@archboard/contracts';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { RuntimeAdmission } from '../../../../platform/lifecycle/runtime-admission.js';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';

import { AUTH_SESSION_LOOKUP, type AuthSessionLookup } from '../../../auth/application/index.js';
import { BoardPermissionService } from '../../../boards/application/index.js';
import type { ApiConfig } from '../../../../platform/config/index.js';
import { CollaborationWriterLockService } from '../../../../platform/database/index.js';
import { CollaborationGateway } from './collaboration.gateway.js';
import { WEBSOCKET_API_CONFIG } from './websocket.tokens.js';
import { MAX_PENDING_UPGRADES } from '../../application/collaboration-limits.js';

const BOARD_WEBSOCKET_PATH = /^\/ws\/boards\/([^/]+)$/;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const STATUS_TEXT: Readonly<Record<number, string>> = {
  [HTTP_BAD_REQUEST]: 'Bad Request',
  [HTTP_UNAUTHORIZED]: 'Unauthorized',
  [HTTP_FORBIDDEN]: 'Forbidden',
  [HTTP_NOT_FOUND]: 'Not Found',
  [HTTP_REQUEST_TIMEOUT]: 'Request Timeout',
  [HTTP_SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HTTP_INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};

class HandshakeTimeoutError extends Error {}
class UpgradeBusyError extends Error {}

@Injectable()
export class CollaborationUpgradeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private httpServer: HttpServer | undefined;
  private stopped = false;
  private readonly operations = new Set<Promise<void>>();
  private readonly sockets = new Set<Duplex>();
  // Timed-out session lookups remain charged until underlying work actually settles.
  private readonly pendingLookups = new Set<Promise<unknown>>();

  public constructor(
    @Inject(HttpAdapterHost) private readonly httpAdapterHost: HttpAdapterHost,
    @Inject(AUTH_SESSION_LOOKUP) private readonly sessionLookup: AuthSessionLookup,
    @Inject(WEBSOCKET_API_CONFIG) private readonly config: ApiConfig,
    @Inject(BoardPermissionService) private readonly permissions: BoardPermissionService,
    @Inject(CollaborationWriterLockService)
    private readonly writerLock: CollaborationWriterLockService,
    @Inject(CollaborationGateway) private readonly gateway: CollaborationGateway,
    @Optional() @Inject(RuntimeAdmission) private readonly admission?: RuntimeAdmission,
  ) {}

  public onApplicationBootstrap(): void {
    this.httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as HttpServer;
    this.httpServer.on('upgrade', this.handleUpgrade);
  }

  public onApplicationShutdown(): void {
    this.stopAdmission();
  }

  public stopAdmission(): void {
    this.stopped = true;
    this.httpServer?.off('upgrade', this.handleUpgrade);
    for (const socket of this.sockets) socket.destroy();
  }

  public async drain(): Promise<void> {
    await Promise.allSettled([...this.operations]);
  }

  private readonly handleUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    if (this.stopped) {
      socket.destroy();
      return;
    }
    if (this.operations.size >= MAX_PENDING_UPGRADES) {
      this.rejectUpgrade(socket, HTTP_SERVICE_UNAVAILABLE);
      return;
    }
    this.sockets.add(socket);
    const operation = this.authenticateUpgrade(request, socket, head).catch(() => {
      this.rejectUpgrade(socket, HTTP_INTERNAL_SERVER_ERROR);
    });
    this.operations.add(operation);
    void operation.finally(() => {
      this.operations.delete(operation);
      this.sockets.delete(socket);
    });
  };

  private async authenticateUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const pathname = new URL(request.url ?? '/', this.config.publicApiOrigin).pathname;
    const match = BOARD_WEBSOCKET_PATH.exec(pathname);
    if (match === null) {
      this.rejectUpgrade(socket, HTTP_NOT_FOUND);
      return;
    }
    const parsedBoardId = applicationIdSchema.safeParse(match[1]);
    if (!parsedBoardId.success) {
      this.rejectUpgrade(socket, HTTP_BAD_REQUEST);
      return;
    }
    const boardId = parsedBoardId.data;
    if (
      typeof request.headers.origin !== 'string' ||
      !this.config.allowedWebOrigins.includes(request.headers.origin)
    ) {
      this.rejectUpgrade(socket, HTTP_FORBIDDEN);
      return;
    }
    if (!this.canAdmit() || !(await this.writerLock.isReady())) {
      this.rejectUpgrade(socket, HTTP_SERVICE_UNAVAILABLE);
      return;
    }
    let session: Awaited<ReturnType<AuthSessionLookup['lookup']>>;
    try {
      session = await this.sessionWithinDeadline(request);
    } catch (error) {
      this.rejectUpgrade(
        socket,
        error instanceof UpgradeBusyError
          ? HTTP_SERVICE_UNAVAILABLE
          : error instanceof HandshakeTimeoutError
            ? HTTP_REQUEST_TIMEOUT
            : HTTP_UNAUTHORIZED,
      );
      return;
    }
    if (session === null) {
      this.rejectUpgrade(socket, HTTP_UNAUTHORIZED);
      return;
    }
    const permission = await this.permissions.read(boardId, session.userId);
    if (!permission.allowed) {
      // Missing and inaccessible boards have the same upgrade response.
      this.rejectUpgrade(socket, HTTP_NOT_FOUND);
      return;
    }
    if (this.stopped || socket.destroyed) return;
    if (!this.canAdmit()) {
      this.rejectUpgrade(socket, HTTP_SERVICE_UNAVAILABLE);
      return;
    }
    this.gateway.acceptUpgrade(request, socket, head, {
      boardId,
      userId: session.userId,
      userName: session.user.name,
    });
  }

  private canAdmit(): boolean {
    return this.admission === undefined || this.admission.accepting;
  }

  private async sessionWithinDeadline(request: IncomingMessage) {
    if (this.pendingLookups.size >= MAX_PENDING_UPGRADES) throw new UpgradeBusyError();
    const lookup = this.sessionLookup.lookup(fromNodeHeaders(request.headers));
    this.pendingLookups.add(lookup);
    void lookup.finally(() => this.pendingLookups.delete(lookup)).catch(() => undefined);
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        lookup,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new HandshakeTimeoutError()), HELLO_TIMEOUT_MS);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private rejectUpgrade(socket: Duplex, status: number): void {
    if (socket.destroyed) return;
    const reason = STATUS_TEXT[status] ?? STATUS_TEXT[HTTP_INTERNAL_SERVER_ERROR];
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }
}
