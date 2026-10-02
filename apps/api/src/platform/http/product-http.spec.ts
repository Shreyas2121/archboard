import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureProductHttp } from './product-http.js';

const ORDINARY_LIMIT_BYTES = 65_536;
const INVALID_UTF8_BYTE = 255;
const IMPORT_PATH = '/api/v1/imports';

describe('portable request parser boundary', () => {
  function verify(url: string, bytes: Buffer): void {
    let check: (request: IncomingMessage, response: ServerResponse, bytes: Buffer) => void = () => {
      throw new Error('Parser was not registered');
    };
    const application = {
      use: () => undefined,
      useBodyParser: (_kind: string, options: { verify: typeof check }) => {
        check = options.verify;
      },
    } as unknown as NestExpressApplication;
    configureProductHttp(application);
    check({ url } as IncomingMessage, {} as ServerResponse, bytes);
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
});
