import { boardStorageNamespaceKey, type BoardStorageNamespace } from '../persistence/namespace.js';
import { LOCK_HINT_CHANNEL_PREFIX, WRITER_LOCK_PREFIX } from './constants.js';

export function writerLockName(namespace: BoardStorageNamespace): string {
  return `${WRITER_LOCK_PREFIX}${boardStorageNamespaceKey(namespace)}`;
}

export function lockHintChannelName(namespace: BoardStorageNamespace): string {
  return `${LOCK_HINT_CHANNEL_PREFIX}${boardStorageNamespaceKey(namespace)}`;
}
