import { jest } from '@jest/globals';
import { ShutdownDeadline } from './shutdown-deadline.js';
const TEST_DEADLINE_MS = 20;

class TestDeadline extends ShutdownDeadline {
  public exits = 0;
  protected override terminate(): void {
    this.exits++;
  }
}
afterEach(() => jest.useRealTimers());

it('terminates hung shutdown without resolving its drain or releasing ownership', async () => {
  jest.useFakeTimers();
  const deadline = new TestDeadline();
  const result = deadline.run(() => new Promise<void>(() => undefined), TEST_DEADLINE_MS);
  const rejected = expect(result).rejects.toThrow('Shutdown deadline exceeded');
  await jest.advanceTimersByTimeAsync(TEST_DEADLINE_MS);
  await rejected;
  expect(deadline.exits).toBe(1);
  expect(jest.getTimerCount()).toBe(0);
});

it('clears the watchdog after successful shutdown', async () => {
  jest.useFakeTimers();
  const deadline = new TestDeadline();
  await expect(deadline.run(async () => 'closed', TEST_DEADLINE_MS)).resolves.toBe('closed');
  await jest.advanceTimersByTimeAsync(TEST_DEADLINE_MS);
  expect(deadline.exits).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});
