import type { CreateInvite } from '@archboard/contracts';

// Memory only. A lost response retains the exact operation, never a bearer URL.
export interface InviteRequest {
  readonly key: string;
  readonly input: CreateInvite;
  readonly startedAt: number;
}

const RETRY_WINDOW_MS = 82_800_000; // 23 hours

export function canReconcileInvite(request: InviteRequest, now: number): boolean {
  // Leave margin before the server's 24-hour retention boundary.
  return now >= request.startedAt && now - request.startedAt < RETRY_WINDOW_MS;
}
