import * as Y from 'yjs';

import { LOCAL_EDIT_ORIGIN, LOCAL_STRUCTURAL_ORIGIN } from '../commands/internal.js';

export const COMMAND_ORIGINS = {
  LOCAL_EDIT: LOCAL_EDIT_ORIGIN,
  LOCAL_STRUCTURAL: LOCAL_STRUCTURAL_ORIGIN,
  REMOTE: Symbol('archboard.remote'),
  HYDRATION: Symbol('archboard.hydration'),
} as const;

export function applyRemoteUpdate(document: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(document, update, COMMAND_ORIGINS.REMOTE);
}

export function applyHydrationUpdate(document: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(document, update, COMMAND_ORIGINS.HYDRATION);
}
