import { LOCAL_PERSISTENCE_PHASES, type LocalPersistenceStatus } from '@archboard/sync-client';

export function localWriteDescription(status: LocalPersistenceStatus | null): string {
  if (status === null) return 'Local write status is unavailable.';
  if (status.phase === LOCAL_PERSISTENCE_PHASES.STORAGE_ERROR)
    return 'Storage error. Current in-memory changes are not confirmed on this device.';
  if (status.phase === LOCAL_PERSISTENCE_PHASES.RECOVERY_REQUIRED)
    return 'Stored data needs recovery. Do not assume the current board is saved.';
  if (status.savedOnDevice && status.pendingWrites === 0)
    return 'All local writes have committed on this device.';
  return 'Local writes are not yet confirmed on this device.';
}

export function formatStorageBytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 'Unavailable';
  const MIB = 1_048_576;
  return `${(value / MIB).toFixed(1)} MiB`;
}
