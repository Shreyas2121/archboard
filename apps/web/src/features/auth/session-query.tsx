import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { clearAccountBoardNamespaces } from '@archboard/sync-client';
import { PendingChangesDialog } from './pending-changes-dialog';
import { currentUserQueryOptions } from './current-user-query';
import {
  approveAccountSwitch,
  getPendingAccountSwitch,
  subscribePendingAccountSwitch,
  setPendingAccountSwitch,
  installSessionBoundary,
} from './auth-transition-coordinator';
export { CURRENT_USER_QUERY_KEY, queryClient } from './session-query-definitions';
export type { PendingAccountSwitch } from './session-query-definitions';
export {
  approveAccountSwitch,
  clearAuthenticatedState,
  signOut,
} from './auth-transition-coordinator';

export function usePendingAccountSwitch() {
  return useSyncExternalStore(
    subscribePendingAccountSwitch,
    getPendingAccountSwitch,
    getPendingAccountSwitch,
  );
}
export function useCurrentUser() {
  return useQuery(currentUserQueryOptions);
}
export function SessionBoundary() {
  const pendingSwitch = usePendingAccountSwitch();
  useEffect(installSessionBoundary, []);
  return pendingSwitch === null ? null : (
    <PendingChangesDialog
      key={`${pendingSwitch.previousUserId}:${pendingSwitch.nextUserId}`}
      open
      action="switch accounts"
      boards={pendingSwitch.boards}
      onCancel={() => setPendingAccountSwitch(null)}
      onRetain={async () => approveAccountSwitch(pendingSwitch.nextUserId)}
      onClear={async () => {
        await clearAccountBoardNamespaces(
          { deploymentOrigin: window.location.origin, userId: pendingSwitch.previousUserId },
          pendingSwitch.boards,
        );
        approveAccountSwitch(pendingSwitch.nextUserId);
      }}
    />
  );
}
