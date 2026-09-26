export const SYNC_DATABASE_NAME = 'archboard-sync-client' as const;
// IndexedDB schema version advances when durable sync stores are added.
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
export const SYNC_DATABASE_VERSION = 2 as const;
export const LOCAL_DEMO_USER_KEY = 'local-demo' as const;

export const SYNC_STORE_NAMES = {
  LOCAL_SNAPSHOTS: 'localSnapshots',
  LOCAL_UPDATES: 'localUpdates',
  OUTBOX: 'outbox',
  OUTBOX_RECEIPTS: 'outboxReceipts',
  RECEIVED_STATE: 'receivedState',
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

// Named product budgets are intentionally literal and audited at their exact boundaries.
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
export const LOCAL_SNAPSHOT_UPDATE_THRESHOLD = 32 as const;
// eslint-disable-next-line @typescript-eslint/no-magic-numbers
export const LOCAL_SNAPSHOT_BYTE_THRESHOLD = 512 * 1024;
