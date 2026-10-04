import { randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';
import { MAX_AI_RESULT_BYTES } from '@archboard/contracts';
import { AesGcmAiPayloadCipher } from './payload-cipher.js';
import type { AiEncryptedPayload } from '../../application/persistence.js';
import { fixtureAiResult, TEST_KEY, TEST_KEY_VERSION } from '../testing/persistence-fixtures.js';
const OVERHEAD = 28;
const nonceBinding = () => ({
  deploymentNamespace: 'fixture-deployment',
  actorUserId: 'actor',
  originRunId: randomUUID(),
  id: randomUUID(),
  schemaVersion: 1 as const,
  keyVersion: TEST_KEY_VERSION,
  expiresAt: new Date('2026-10-04T10:15:00Z'),
});
describe('bounded authenticated AI payload encryption', () => {
  it('round trips Unicode with fresh random nonces and no serializable key', () => {
    const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
    const binding = nonceBinding();
    const first = cipher.seal(binding, fixtureAiResult);
    const second = cipher.seal(binding, fixtureAiResult);
    expect(cipher.open(first)).toEqual(fixtureAiResult);
    expect(Buffer.from(first.nonce).equals(Buffer.from(second.nonce))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
    expect(first.byteLength).toBe(first.ciphertext.byteLength + OVERHEAD);
    expect(JSON.stringify(cipher)).not.toContain(TEST_KEY);
  });
  it.each([
    'deploymentNamespace',
    'actorUserId',
    'originRunId',
    'id',
    'schemaVersion',
    'keyVersion',
    'expiresAt',
  ] as const)('authenticates %s and rejects swapped ownership/version/expiry', (field) => {
    const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
    const payload = cipher.seal(nonceBinding(), fixtureAiResult);
    const changed = {
      ...payload,
      [field]:
        field === 'expiresAt'
          ? new Date(0)
          : field === 'schemaVersion'
            ? 0
            : field === 'id' || field === 'originRunId'
              ? randomUUID()
              : 'other',
    };
    expect(() => cipher.open(changed as AiEncryptedPayload)).toThrow(
      expect.objectContaining({
        code: 'AI_RESULT_EXPIRED',
        message: 'AI persistence operation failed.',
      }),
    );
  });
  it.each(['nonce', 'tag', 'ciphertext'] as const)(
    'rejects tampered %s and does not expose native crypto diagnostics',
    (field) => {
      const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
      const payload = cipher.seal(nonceBinding(), fixtureAiResult);
      const changed = Buffer.from(payload[field]);
      changed[0] = changed[0]! ^ 1;
      expect(() => cipher.open({ ...payload, [field]: changed })).toThrow(
        expect.objectContaining({ code: 'AI_RESULT_EXPIRED' }),
      );
    },
  );
  it('rejects mismatched byte accounting, unavailable keys, unknown result fields and oversized bytes', () => {
    const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
    const payload = cipher.seal(nonceBinding(), fixtureAiResult);
    expect(() => cipher.open({ ...payload, byteLength: 1 })).toThrow();
    expect(() =>
      new AesGcmAiPayloadCipher('c'.repeat(TEST_KEY.length), TEST_KEY_VERSION).open(payload),
    ).toThrow();
    expect(() =>
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION, 1).seal(
        nonceBinding(),
        fixtureAiResult,
      ),
    ).toThrow();
    expect(() =>
      cipher.seal(nonceBinding(), {
        ...fixtureAiResult,
        secret: 'private',
      } as unknown as typeof fixtureAiResult),
    ).toThrow();
    expect(
      () => new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION, MAX_AI_RESULT_BYTES + 1),
    ).toThrow();
  });
  it('fails closed on malformed key material and binding versions', () => {
    expect(() => new AesGcmAiPayloadCipher('private-key-invalid', TEST_KEY_VERSION)).toThrow(
      expect.objectContaining({ code: 'TEMPORARILY_UNAVAILABLE' }),
    );
    const cipher = new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION);
    expect(() => cipher.seal({ ...nonceBinding(), keyVersion: 'other' }, fixtureAiResult)).toThrow(
      expect.objectContaining({ code: 'AI_OUTPUT_INVALID' }),
    );
  });
});
