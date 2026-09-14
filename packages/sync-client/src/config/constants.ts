export const SYNC_DATABASE_NAME = 'archboard-sync-client' as const;
export const SYNC_DATABASE_VERSION = 1 as const;

export const SYNC_STORE_NAMES = {
  LOCAL_SNAPSHOTS: 'localSnapshots',
  LOCAL_UPDATES: 'localUpdates',
  OUTBOX: 'outbox',
  BOARD_CACHE: 'boardCache',
} as const;

export const SYNC_INDEX_NAMES = {
  BY_NAMESPACE: 'byNamespace',
  BY_NAMESPACE_AND_SEQUENCE: 'byNamespaceAndSequence',
} as const;

export const LOCAL_UPDATE_DIRECTIONS = {
  LOCAL: 'local',
  REMOTE: 'remote',
} as const;

export const OUTBOX_STATUSES = {
  PENDING: 'pending',
} as const;

export const UPDATE_HASH_ALGORITHM = 'SHA-256' as const;
