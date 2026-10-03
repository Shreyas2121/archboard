import {
  MAX_CLIENT_UPDATE_BYTES,
  MAX_WS_FRAME_BYTES,
  MAX_ACTIVE_ROOMS,
  MAX_BOARD_CONNECTIONS,
} from '@archboard/contracts';

// Leave room for a maximum ready snapshot plus ordered updates already handed to ws.
const SOCKET_FRAME_BUDGET = 2;
const PENDING_UPDATE_BUDGET = 4;
export const MAX_SOCKET_BUFFERED_BYTES = SOCKET_FRAME_BUDGET * MAX_WS_FRAME_BYTES;
export const MAX_PENDING_ROOM_UPDATE_BYTES = PENDING_UPDATE_BUDGET * MAX_CLIENT_UPDATE_BYTES;
export const MAX_PENDING_ROOM_UPDATES = 128;
export const MAX_PENDING_ACTIVATION_BYTES = MAX_WS_FRAME_BYTES;
export const MAX_PENDING_ACTIVATION_FRAMES = 40;
// Includes active work; protects the serial room tail from transient/control floods.
export const MAX_QUEUED_ROOM_OPERATIONS = MAX_PENDING_ROOM_UPDATES * MAX_BOARD_CONNECTIONS;
// Authenticated sockets waiting for hello/room admission also consume capacity.
export const MAX_AUTHENTICATED_SOCKETS = MAX_ACTIVE_ROOMS * MAX_BOARD_CONNECTIONS;
export const MAX_PENDING_UPGRADES = MAX_AUTHENTICATED_SOCKETS;
export const MAX_TRAFFIC_SCOPES = MAX_ACTIVE_ROOMS * (MAX_BOARD_CONNECTIONS + 1);
