import { jest } from '@jest/globals';
import type { LoggerService } from '@nestjs/common';
import { PrivacyLogger } from './privacy-logger.js';
import { logAuthDiagnostic } from '../../modules/auth/infrastructure/auth-diagnostics.js';

afterEach(() => jest.restoreAllMocks());

it('withholds framework exceptions, arguments, stacks and auth provider content', () => {
  const sink = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const secret = 'synthetic-private-body-and-token';
  const logger: LoggerService = new PrivacyLogger();
  logger.error(new Error(secret), secret, secret);
  logger.log({ cookie: secret });
  logger.warn(secret);
  logAuthDiagnostic(secret);
  expect(sink.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
    { event: 'framework.diagnostic', level: 'error' },
    { event: 'framework.diagnostic', level: 'info' },
    { event: 'framework.diagnostic', level: 'warn' },
    { event: 'auth.diagnostic', level: 'unknown' },
  ]);
  expect(JSON.stringify(sink.mock.calls)).not.toContain(secret);
});

it('does not propagate diagnostic sink failures', () => {
  jest.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('sink unavailable');
  });
  expect(() => new PrivacyLogger().error()).not.toThrow();
  expect(() => logAuthDiagnostic('error')).not.toThrow();
});
