export const WRITER_LOCK_VERSION = 1 as const;
export const WRITER_LOCK_PREFIX = `archboard:writer:v${WRITER_LOCK_VERSION}:` as const;
export const LOCK_HINT_CHANNEL_PREFIX = `archboard:lock-hints:v${WRITER_LOCK_VERSION}:` as const;

export const LOCK_HINT_TYPES = {
  CACHE_CHANGED: 'cache-changed',
  RESET_COMPLETE: 'reset-complete',
  LOCK_RELEASED: 'lock-released',
} as const;

export type LockHintType = (typeof LOCK_HINT_TYPES)[keyof typeof LOCK_HINT_TYPES];
