import type { InviteStage } from './invite-acceptance';

export const INVITE_STAGE_COPY: Readonly<
  Record<InviteStage, { title: string; description: string }>
> = {
  idle: {
    title: 'Review invitation',
    description: 'Loading the invitation for this signed-in account.',
  },
  loading: {
    title: 'Loading invitation…',
    description: 'Checking your session and invitation details.',
  },
  ready: {
    title: 'You’re invited',
    description:
      'Review the offered access before accepting. Existing editor access will not be downgraded.',
  },
  accepting: {
    title: 'Accepting invitation…',
    description: 'Checking current availability and confirming your access.',
  },
  accepted: {
    title: 'Invitation accepted',
    description: 'Your access is confirmed. Opening the board with its current role.',
  },
  'already-member': {
    title: 'You already have access',
    description: 'Your existing access is preserved. Opening the board with its current role.',
  },
  expired: {
    title: 'Invitation expired',
    description: 'Ask the board owner for a new invitation.',
  },
  unavailable: {
    title: 'Invitation unavailable',
    description: 'This link is invalid or has been revoked. Ask the owner for a new invitation.',
  },
  exhausted: {
    title: 'Invitation already used',
    description:
      'This invitation has been consumed. If you previously accepted it with this account, explicitly confirm that result below. Otherwise ask the owner for a new invitation.',
  },
  archived: {
    title: 'Board is archived',
    description: 'The owner must restore this board before an invitation can be accepted.',
  },
  'session-expired': {
    title: 'Your session expired',
    description:
      'Sign in again to review this invitation. Your retained local boards stay in their original account.',
  },
  network: {
    title: 'Invitation could not load',
    description:
      'The server could not be reached or returned an unexpected response. This does not establish whether the invitation is valid.',
  },
  uncertain: {
    title: 'Acceptance is unconfirmed',
    description:
      'The response was lost. Confirm the original acceptance explicitly; the server safely reuses a recorded result for this account. Reconnection will not accept automatically.',
  },
};
