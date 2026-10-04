import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureProductHttp } from './product-http.js';
import { MAX_AI_REQUEST_BYTES } from '@archboard/contracts';

const ORDINARY_LIMIT_BYTES = 65_536;
const INVALID_UTF8_BYTE = 255;
const IMPORT_PATH = '/api/v1/imports';

describe('portable request parser boundary', () => {
  function verify(url: string, bytes: Buffer): void {
    type Check = (request: IncomingMessage, response: ServerResponse, bytes: Buffer) => void;
    const parsers: { verify: Check; type?: (request: IncomingMessage) => boolean }[] = [];
    const application = {
      use: () => undefined,
      useBodyParser: (
        _kind: string,
        options: { verify: Check; type?: (request: IncomingMessage) => boolean },
      ) => {
        parsers.push(options);
      },
    } as unknown as NestExpressApplication;
    configureProductHttp(application);
    const request = {
      url,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    } as IncomingMessage;
    const parser = parsers.find((parser) => !parser.type || parser.type(request));
    if (!parser) throw new Error('Parser was not registered');
    parser.verify(request, {} as ServerResponse, bytes);
  }
  it('retains the ordinary 64 KiB cap while allowing bounded import overhead', () => {
    const bytes = Buffer.from(JSON.stringify({ text: 'x'.repeat(ORDINARY_LIMIT_BYTES) }));
    expect(() => verify('/api/v1/boards', bytes)).toThrow();
    expect(() => verify(IMPORT_PATH, bytes)).not.toThrow();
  });
  it('rejects invalid UTF-8 and prototype keys before server schema work', () => {
    expect(() => verify(IMPORT_PATH, Buffer.from([INVALID_UTF8_BYTE]))).toThrow();
    expect(() => verify(IMPORT_PATH, Buffer.from('{"constructor":{}}'))).toThrow();
  });
  it('only widens exact AI creation while preserving import and ordinary ceilings', () => {
    const bytes = Buffer.from(JSON.stringify({ text: 'x'.repeat(ORDINARY_LIMIT_BYTES) }));
    expect(() => verify('/api/v1/ai/runs', bytes)).not.toThrow();
    for (const path of ['/api/v1/ai/runs/', '/api/v1/ai/runs/forged/cancel', '/api/v1/boards'])
      expect(() => verify(path, bytes)).toThrow();
    expect(() => verify('/api/v1/ai/runs', Buffer.alloc(MAX_AI_REQUEST_BYTES + 1))).toThrow();
    expect(() => verify('/api/v1/ai/runs', Buffer.from('{"__proto__":{}}'))).toThrow();
    expect(() => verify('/api/v1/ai/runs', Buffer.from([INVALID_UTF8_BYTE]))).toThrow();
  });
});
