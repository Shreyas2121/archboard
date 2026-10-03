import { afterEach, expect, it, vi } from 'vitest';
import {
  HighlightScheduler,
  MAX_PENDING_HIGHLIGHTS,
} from '@/features/editor/cards/highlight-scheduler';

afterEach(() => vi.useRealTimers());
const RAPID_EDITS = 100;

it('coalesces a rapid edited/unmounted card before tokenization', async () => {
  vi.useFakeTimers();
  const scheduler = new HighlightScheduler();
  const run = vi.fn(async () => {});
  for (let index = 0; index < RAPID_EDITS; index++) scheduler.schedule(run)?.();
  scheduler.schedule(run);
  await vi.runAllTimersAsync();
  expect(run).toHaveBeenCalledTimes(1);
});

it('bounds waiting work and serializes active jobs, releasing capacity after rejection', async () => {
  vi.useFakeTimers();
  const scheduler = new HighlightScheduler();
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = vi.fn(() => blocked);
  const second = vi.fn(async () => {});
  scheduler.schedule(first);
  await vi.advanceTimersByTimeAsync(1);
  for (let index = 0; index < MAX_PENDING_HIGHLIGHTS; index++) scheduler.schedule(second);
  expect(scheduler.schedule(second)).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(second).not.toHaveBeenCalled();
  finish();
  await vi.runAllTimersAsync();
  expect(second).toHaveBeenCalledTimes(MAX_PENDING_HIGHLIGHTS);
  scheduler.schedule(async () => {
    throw new Error('Synthetic tokenization failure');
  });
  scheduler.schedule(second);
  await vi.runAllTimersAsync();
  expect(second).toHaveBeenCalledTimes(MAX_PENDING_HIGHLIGHTS + 1);
});
