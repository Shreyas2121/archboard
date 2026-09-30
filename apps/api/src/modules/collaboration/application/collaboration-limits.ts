import { MAX_CLIENT_UPDATE_BYTES, MAX_WS_FRAME_BYTES } from '@archboard/contracts';

// Leave room for a maximum ready snapshot plus ordered updates already handed to ws.
const SOCKET_FRAME_BUDGET = 2;
const PENDING_UPDATE_BUDGET = 4;
export const MAX_SOCKET_BUFFERED_BYTES = SOCKET_FRAME_BUDGET * MAX_WS_FRAME_BYTES;
export const MAX_PENDING_ROOM_UPDATE_BYTES = PENDING_UPDATE_BUDGET * MAX_CLIENT_UPDATE_BYTES;
export const MAX_PENDING_ROOM_UPDATES = 128;
export const MAX_PENDING_ACTIVATION_BYTES = MAX_WS_FRAME_BYTES;
export const MAX_PENDING_ACTIVATION_FRAMES = 40;
