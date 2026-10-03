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
