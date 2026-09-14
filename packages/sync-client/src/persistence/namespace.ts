import { applicationIdSchema } from '@archboard/contracts';

export interface BoardStorageNamespace {
  readonly deploymentOrigin: string;
  readonly userId: string;
  readonly boardId: string;
  readonly graphSchemaVersion: number;
}

function requireNonEmpty(value: string, name: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be non-empty and must not have surrounding whitespace.`);
  }
}

export function boardStorageNamespaceKey(namespace: BoardStorageNamespace): string {
  requireNonEmpty(namespace.userId, 'userId');
  applicationIdSchema.parse(namespace.boardId);
  if (!Number.isSafeInteger(namespace.graphSchemaVersion) || namespace.graphSchemaVersion < 1) {
    throw new TypeError('graphSchemaVersion must be a positive safe integer.');
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(namespace.deploymentOrigin);
  } catch {
    throw new TypeError('deploymentOrigin must be an absolute URL origin.');
  }
  if (parsedOrigin.origin !== namespace.deploymentOrigin) {
    throw new TypeError('deploymentOrigin must contain an origin only.');
  }

  return JSON.stringify([
    namespace.deploymentOrigin,
    namespace.userId,
    namespace.boardId,
    namespace.graphSchemaVersion,
  ]);
}
