import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { INVITE_TOKEN_BYTES, inviteTokenSchema } from '@archboard/contracts';

const HASH_ALGORITHM = 'sha256';

export function createInviteToken(): { token: string; digest: Buffer } {
  const token = randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
  return { token, digest: digestInviteToken(token)! };
}

export function digestInviteToken(token: string): Buffer | null {
  if (!inviteTokenSchema.safeParse(token).success) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.byteLength !== INVITE_TOKEN_BYTES || bytes.toString('base64url') !== token) return null;
  return createHash(HASH_ALGORITHM).update(bytes).digest();
}

export function digestMatches(expected: Buffer, actual: Buffer): boolean {
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual);
}
