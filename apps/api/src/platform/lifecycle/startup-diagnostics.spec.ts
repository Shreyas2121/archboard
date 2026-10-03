import { jest } from '@jest/globals';
import { ConfigurationError } from '../config/api-config.js';
import { CollaborationWriterLockUnavailableError } from '../database/collaboration-writer-lock.service.js';
import { StartupReadinessUnavailableError } from './startup-errors.js';
import { logStartupFailure, logStartupStage } from './startup-diagnostics.js';

afterEach(() => jest.restoreAllMocks());

it('identifies configuration fields without publishing values, issue messages or arbitrary names', () => {
  const sink = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const privateValue = 'synthetic-password-and-private-host';
  const error = new ConfigurationError('API', [
    { variable: 'DATABASE_URL', message: privateValue },
    { variable: privateValue, message: privateValue },
  ]);
  logStartupFailure('configuration', error);
  expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toEqual({
    event: 'runtime.startup_failed',
    stage: 'configuration',
    code: 'INVALID_CONFIGURATION',
    variables: ['DATABASE_URL'],
  });
  expect(JSON.stringify(sink.mock.calls)).not.toContain(privateValue);
});

it.each([
  [new CollaborationWriterLockUnavailableError(), 'WRITER_ALREADY_RUNNING'],
  [new StartupReadinessUnavailableError(), 'STARTUP_READINESS_UNAVAILABLE'],
  [
    { code: '28P01', message: 'private credentials', detail: 'private SQL' },
    'DATABASE_AUTHENTICATION_FAILED',
  ],
  [{ code: 'ENOTFOUND', hostname: 'private host' }, 'HOST_NOT_FOUND'],
  [{ code: 'private token', message: 'private body' }, 'STARTUP_FAILED'],
  [new Error('private connection string'), 'STARTUP_FAILED'],
  [null, 'STARTUP_FAILED'],
])('classifies known failures and withholds raw exception content %#', (error, code) => {
  const sink = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  logStartupFailure('application_initialization', error);
  expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toEqual({
    event: 'runtime.startup_failed',
    stage: 'application_initialization',
    code,
  });
  expect(JSON.stringify(sink.mock.calls)).not.toContain('private');
});

it('handles hostile exception getters without hiding the failure stage', () => {
  const sink = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  logStartupFailure('listen', {
    get code() {
      throw new Error('private value');
    },
  });
  expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toEqual({
    event: 'runtime.startup_failed',
    stage: 'listen',
    code: 'STARTUP_FAILED',
  });
});

it('reports startup stages and tolerates unavailable logging sinks', () => {
  const sink = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  logStartupStage('application_creation');
  expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toEqual({
    event: 'runtime.startup_stage',
    stage: 'application_creation',
  });
  sink.mockImplementation(() => {
    throw new Error('sink unavailable');
  });
  expect(() => logStartupFailure('configuration', new Error('private'))).not.toThrow();
  expect(() => logStartupStage('configuration')).not.toThrow();
});
