import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { afterEach, expect, it, jest } from '@jest/globals';
import type { HttpAdapterHost } from '@nestjs/core';
import { HELLO_TIMEOUT_MS } from '@archboard/contracts';
import type { AuthSessionLookup } from '../../../auth/application/index.js';
import type { BoardPermissionService } from '../../../boards/application/index.js';
import type { ApiConfig } from '../../../../platform/config/index.js';
import type { CollaborationWriterLockService } from '../../../../platform/database/index.js';
import type { CollaborationGateway } from './collaboration.gateway.js';
import { MAX_PENDING_UPGRADES } from '../../application/collaboration-limits.js';
import { CollaborationUpgradeService } from './collaboration-upgrade.service.js';

const SETTLE_TURNS = 20;
async function settle() {
  for (let index = 0; index < SETTLE_TURNS; index++) await Promise.resolve();
}
afterEach(() => {
  jest.useRealTimers();
});

it('bounds pre-hello upgrade work and keeps timed-out underlying lookups charged until settlement', async () => {
  jest.useFakeTimers();
  let release!: (value: null) => void;
  const pending = new Promise<null>((resolve) => {
    release = resolve;
  });
  const lookup = jest.fn<AuthSessionLookup['lookup']>().mockImplementation(async () => pending);
  const server = new EventEmitter();
  const adapter = { httpAdapter: { getHttpServer: () => server } } as unknown as HttpAdapterHost;
  const gateway = { acceptUpgrade: jest.fn() } as unknown as CollaborationGateway;
  const permissions = { read: jest.fn() } as unknown as BoardPermissionService;
  const service = new CollaborationUpgradeService(
    adapter,
    { lookup },
    {
      publicApiOrigin: 'https://example.test',
      allowedWebOrigins: ['https://example.test'],
    } as unknown as ApiConfig,
    permissions,
    { isReady: async () => true } as CollaborationWriterLockService,
    gateway,
  );
  service.onApplicationBootstrap();
  const sockets: Duplex[] = [];
  function upgrade() {
    let response = '';
    const socket = new Duplex({
      read() {},
      write(bytes: Buffer, _encoding, callback) {
        response += bytes.toString();
        callback();
      },
    });
    sockets.push(socket);
    const request = {
      url: `/ws/boards/${randomUUID()}`,
      headers: { origin: 'https://example.test' },
    } as IncomingMessage;
    server.emit('upgrade', request, socket, Buffer.alloc(0));
    return () => response;
  }
  try {
    for (let index = 0; index < MAX_PENDING_UPGRADES; index++) upgrade();
    const overCapacity = upgrade();
    await settle();
    expect(overCapacity()).toContain('503 Service Unavailable');
    expect(lookup).toHaveBeenCalledTimes(MAX_PENDING_UPGRADES);
    await jest.advanceTimersByTimeAsync(HELLO_TIMEOUT_MS);
    await service.drain();
    const afterTimeout = upgrade();
    await settle();
    expect(afterTimeout()).toContain('503 Service Unavailable');
    expect(lookup).toHaveBeenCalledTimes(MAX_PENDING_UPGRADES);
    release(null);
    await settle();
    lookup.mockResolvedValue(null);
    const next = upgrade();
    await settle();
    expect(next()).toContain('401 Unauthorized');
    expect(lookup).toHaveBeenCalledTimes(MAX_PENDING_UPGRADES + 1);
    expect(gateway.acceptUpgrade).not.toHaveBeenCalled();
    expect(permissions.read).not.toHaveBeenCalled();
  } finally {
    release(null);
    service.stopAdmission();
    for (const socket of sockets) socket.destroy();
    await service.drain();
  }
});
