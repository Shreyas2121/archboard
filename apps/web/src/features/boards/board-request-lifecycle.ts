/** Fence both ends of a read, including adapters that finish after cancellation. */
export async function readInBoardScope<T>(
  signal: AbortSignal,
  current: () => boolean,
  read: () => Promise<T>,
): Promise<T> {
  const assertCurrent = () => {
    if (signal.aborted || !current())
      throw new Error('Board access changed. Reconnect and refresh current access.');
  };
  assertCurrent();
  const result = await read();
  assertCurrent();
  return result;
}
