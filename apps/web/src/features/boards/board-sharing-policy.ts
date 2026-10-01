import type { BoardRole } from '@archboard/contracts';

export interface SharingAuthority {
  readonly accountMatches: boolean;
  readonly authenticated: boolean;
  readonly online: boolean;
  readonly denied: boolean;
  readonly fresh: boolean;
  readonly archived: boolean;
  readonly role: BoardRole | null;
  readonly accountId: string;
  readonly ownerId: string | null;
}

export function sharingWriteBlocker(authority: SharingAuthority): string | null {
  if (!authority.accountMatches) return 'This board belongs to a different account session.';
  if (authority.denied) return 'Server access ended. Your local recovery copy is retained.';
  if (!authority.online) return 'Reconnect before changing board access.';
  if (!authority.authenticated) return 'Sign in again before changing board access.';
  if (!authority.fresh) return 'Refresh members and board access before making changes.';
  if (authority.archived) return 'This board is archived. Restore it before changing access.';
  return null;
}

export function canManageMember(authority: SharingAuthority, targetId: string): boolean {
  return (
    sharingWriteBlocker(authority) === null &&
    authority.role === 'owner' &&
    authority.ownerId === authority.accountId &&
    targetId !== authority.ownerId
  );
}

export function canManageInvites(authority: SharingAuthority): boolean {
  return (
    sharingWriteBlocker(authority) === null &&
    authority.role === 'owner' &&
    authority.ownerId === authority.accountId
  );
}

export function canLeaveBoard(authority: SharingAuthority): boolean {
  return (
    sharingWriteBlocker(authority) === null &&
    authority.ownerId !== null &&
    authority.ownerId !== authority.accountId &&
    (authority.role === 'editor' || authority.role === 'viewer')
  );
}

export const SHARING_ROLE_LABELS: Readonly<Record<BoardRole, string>> = {
  owner: 'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

export type SharingConfirmation =
  | { readonly kind: 'remove'; readonly userId: string; readonly name: string }
  | { readonly kind: 'leave' };
