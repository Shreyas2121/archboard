import { afterEach, expect, it, jest } from '@jest/globals';
import { reportCollaborationMetric } from './collaboration-metrics.js';

afterEach(() => {
  jest.restoreAllMocks();
});

it('diagnostic sink failures cannot change collaboration control flow', () => {
  jest.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('Synthetic sink failure');
  });
  expect(() =>
    reportCollaborationMetric('collaboration.validation_worker', { durationMs: 4 }),
  ).not.toThrow();
});

it('withholds arbitrary fields, event labels and invalid measurements', () => {
  const sink = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  reportCollaborationMetric('synthetic-private-event', { count: 1 });
  reportCollaborationMetric('collaboration.update_reject', {
    count: 1,
    code: 'FORBIDDEN',
    body: 'synthetic-private-body',
    event: 'synthetic-private-event',
    kind: 'synthetic-private-kind',
    durationMs: Number.NaN,
    depth: -1,
  });
  expect(sink).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toEqual({
    event: 'collaboration.update_reject',
    count: 1,
    code: 'FORBIDDEN',
  });
});
