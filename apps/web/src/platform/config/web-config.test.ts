import { describe, expect, it } from 'vitest';

import { loadWebConfig } from './index.js';

const VALID_ENVIRONMENT = {
  MODE: 'production',
  VITE_API_ORIGIN: 'https://api.example.com',
  VITE_WS_ORIGIN: 'wss://api.example.com',
};

describe('web runtime configuration', () => {
  it('returns only browser-safe public values', () => {
    const config = loadWebConfig({
      ...VALID_ENVIRONMENT,
      DATABASE_URL: 'postgresql://user:secret@database.example.com/archboard',
    });

    expect(config).toEqual({
      apiOrigin: 'https://api.example.com',
      webSocketOrigin: 'wss://api.example.com',
    });
    expect(config).not.toHaveProperty('DATABASE_URL');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    ['missing API origin', { VITE_API_ORIGIN: undefined }, 'VITE_API_ORIGIN'],
    ['API path', { VITE_API_ORIGIN: 'https://api.example.com/v1' }, 'VITE_API_ORIGIN'],
    ['insecure production API', { VITE_API_ORIGIN: 'http://api.example.com' }, 'HTTPS'],
    ['insecure production socket', { VITE_WS_ORIGIN: 'ws://api.example.com' }, 'WSS'],
    ['socket query', { VITE_WS_ORIGIN: 'wss://api.example.com?token=bad' }, 'VITE_WS_ORIGIN'],
  ])('rejects %s', (_caseName, overrides, expectedMessage) => {
    expect(() => loadWebConfig({ ...VALID_ENVIRONMENT, ...overrides })).toThrow(expectedMessage);
  });

  it('allows HTTP and WS only for local development', () => {
    expect(() =>
      loadWebConfig({
        MODE: 'development',
        VITE_API_ORIGIN: 'http://localhost:3000',
        VITE_WS_ORIGIN: 'ws://localhost:3000',
      }),
    ).not.toThrow();
  });
});
