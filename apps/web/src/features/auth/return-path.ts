import { inviteTokenSchema } from '@archboard/contracts';

export type AuthReturnPath = '/boards' | `/invite/${string}`;

export function safeReturnPath(value: unknown): AuthReturnPath | null {
  if (value === '/boards') return '/boards';
  if (typeof value !== 'string' || !value.startsWith('/invite/')) return null;
  const token = inviteTokenSchema.safeParse(value.slice('/invite/'.length));
  return token.success ? `/invite/${token.data}` : null;
}
