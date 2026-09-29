import type { WorkerCompatibility } from './update-policy';

const COMPATIBILITY_MESSAGE = 'ARCHBOARD_UPDATE_COMPATIBILITY';
const WORKER_WAIT_MS = 5_000;

export async function waitingWorkerCompatibility(
  worker: ServiceWorker,
): Promise<WorkerCompatibility | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value: WorkerCompatibility | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      channel.port1.close();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), WORKER_WAIT_MS);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const response = event.data;
      const valid =
        typeof response === 'object' &&
        response !== null &&
        'type' in response &&
        response.type === COMPATIBILITY_MESSAGE &&
        'graphSchemaVersion' in response &&
        Number.isSafeInteger(response.graphSchemaVersion) &&
        'syncDatabaseVersion' in response &&
        Number.isSafeInteger(response.syncDatabaseVersion) &&
        'openClientCount' in response &&
        Number.isSafeInteger(response.openClientCount);
      finish(valid ? (response as WorkerCompatibility) : null);
    };
    try {
      worker.postMessage({ type: COMPATIBILITY_MESSAGE }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

export async function activateWaitingWorker(
  registration: ServiceWorkerRegistration,
  expectedWorker: ServiceWorker,
): Promise<void> {
  if (registration.waiting !== expectedWorker)
    throw new Error('The waiting application version changed. Review it again.');
  const previousController = navigator.serviceWorker.controller;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
    };
    const onChange = () => {
      if (navigator.serviceWorker.controller === previousController) return;
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error('The new application did not take control. Your current page remains open.'),
      );
    }, WORKER_WAIT_MS);
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    try {
      expectedWorker.postMessage({ type: 'SKIP_WAITING' });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
