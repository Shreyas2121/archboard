import {
  INVITE_TOKEN_BYTES,
  INVITE_TOKEN_CHARACTERS,
  inviteTokenSchema,
} from '@archboard/contracts';

import { createInviteToken, digestInviteToken, digestMatches } from './invite-token.js';

const SHA256_DIGEST_BYTES = 32;

describe('invite token cryptography', () => {
  it('creates canonical 32-byte random tokens and stable SHA-256 digests', () => {
    const first = createInviteToken();
    const second = createInviteToken();
    expect(inviteTokenSchema.safeParse(first.token).success).toBe(true);
    expect(Buffer.from(first.token, 'base64url').byteLength).toBe(INVITE_TOKEN_BYTES);
    expect(first.token === second.token).toBe(false);
    expect(first.digest.byteLength).toBe(SHA256_DIGEST_BYTES);
    expect(digestMatches(first.digest, digestInviteToken(first.token)!)).toBe(true);
    expect(digestMatches(first.digest, second.digest)).toBe(false);
  });

  it('rejects malformed and noncanonical token encodings', () => {
    for (const token of [
      '',
      'x',
      '!'.repeat(INVITE_TOKEN_CHARACTERS),
      'A'.repeat(INVITE_TOKEN_CHARACTERS - 1) + 'B',
    ]) {
      expect(digestInviteToken(token)).toBeNull();
    }
  });
});
