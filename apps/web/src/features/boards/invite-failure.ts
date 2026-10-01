import { ERROR_CODES } from '@archboard/contracts';
import { ApiClientError } from '@/platform/api';
import type { InviteFailure } from './invite-acceptance';

export function inviteFailure(cause: unknown): InviteFailure {
  if (!(cause instanceof ApiClientError)) return 'network';
  if (cause.kind === 'unauthenticated') return 'session-expired';
  if (cause.code === ERROR_CODES.INVITE_EXPIRED) return 'expired';
  if (cause.code === ERROR_CODES.INVITE_EXHAUSTED) return 'exhausted';
  if (cause.code === ERROR_CODES.BOARD_ARCHIVED) return 'archived';
  if (cause.code === ERROR_CODES.INVITE_UNAVAILABLE) return 'unavailable';
  return 'network';
}
