import type { InvalidateMessage } from '@archboard/contracts';

export type BoardResource = InvalidateMessage['data']['resource'];
export const BOARD_RESOURCE_NOTIFICATION = Symbol('BOARD_RESOURCE_NOTIFICATION');
/** Best-effort hints follow committed effects; permissions remain the authority. */
export type BoardResourceNotification = (
  boardId: string,
  resources: readonly BoardResource[],
) => Promise<void>;
