/** Called only after an access transaction commits. */
export const BOARD_ACCESS_NOTIFICATION = Symbol('BOARD_ACCESS_NOTIFICATION');
export type BoardAccessNotification = (boardId: string, userId?: string) => Promise<void>;
