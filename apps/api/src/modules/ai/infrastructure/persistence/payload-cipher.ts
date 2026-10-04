import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  aiResultSchema,
  applicationIdSchema,
  MAX_AI_RESULT_BYTES,
  type AiResult,
} from '@archboard/contracts';
import {
  AiPersistenceError,
  aiActorSchema,
  aiIdentifierSchema,
  type AiEncryptedPayload,
  type AiPayloadBinding,
  type AiPayloadCipher,
} from '../../application/persistence.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX_CHARACTERS = 64;
const bindingSchema = z.strictObject({
  deploymentNamespace: aiIdentifierSchema,
  actorUserId: aiActorSchema,
  originRunId: applicationIdSchema,
  id: applicationIdSchema,
  schemaVersion: z.literal(1),
  keyVersion: aiIdentifierSchema,
  expiresAt: z.date(),
});
const associatedData = (binding: AiPayloadBinding) =>
  Buffer.from(
    JSON.stringify([
      'archboard-ai-result-v1',
      binding.deploymentNamespace,
      binding.actorUserId,
      binding.originRunId,
      binding.id,
      binding.schemaVersion,
      binding.keyVersion,
      binding.expiresAt.toISOString(),
    ]),
  );

export class AesGcmAiPayloadCipher implements AiPayloadCipher {
  readonly #key: Buffer;
  public constructor(
    keyHex: string,
    public readonly keyVersion: string,
    private readonly maximumBytes = MAX_AI_RESULT_BYTES,
  ) {
    if (
      !new RegExp(`^[0-9a-fA-F]{${KEY_HEX_CHARACTERS}}$`).test(keyHex) ||
      !aiIdentifierSchema.safeParse(keyVersion).success ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes <= 0 ||
      maximumBytes > MAX_AI_RESULT_BYTES
    )
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    this.#key = Buffer.from(keyHex, 'hex');
  }
  public seal(input: AiPayloadBinding, result: AiResult): AiEncryptedPayload {
    try {
      const binding = bindingSchema.parse(input);
      if (binding.keyVersion !== this.keyVersion) throw new Error();
      const plaintext = Buffer.from(JSON.stringify(aiResultSchema.parse(result)), 'utf8');
      try {
        if (plaintext.byteLength > this.maximumBytes) throw new Error();
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = createCipheriv('aes-256-gcm', this.#key, nonce, {
          authTagLength: TAG_BYTES,
        });
        cipher.setAAD(associatedData(binding));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
          ...binding,
          nonce,
          ciphertext,
          tag,
          byteLength: ciphertext.byteLength + NONCE_BYTES + TAG_BYTES,
        };
      } finally {
        plaintext.fill(0);
      }
    } catch {
      throw new AiPersistenceError('AI_OUTPUT_INVALID');
    }
  }
  public open(payload: AiEncryptedPayload): AiResult {
    try {
      const binding = bindingSchema.parse({
        deploymentNamespace: payload.deploymentNamespace,
        actorUserId: payload.actorUserId,
        originRunId: payload.originRunId,
        id: payload.id,
        schemaVersion: payload.schemaVersion,
        keyVersion: payload.keyVersion,
        expiresAt: payload.expiresAt,
      });
      if (
        binding.keyVersion !== this.keyVersion ||
        payload.nonce.byteLength !== NONCE_BYTES ||
        payload.tag.byteLength !== TAG_BYTES ||
        payload.ciphertext.byteLength > this.maximumBytes ||
        payload.byteLength !== payload.ciphertext.byteLength + NONCE_BYTES + TAG_BYTES
      )
        throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.#key, payload.nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(associatedData(binding));
      decipher.setAuthTag(payload.tag);
      const partial = decipher.update(payload.ciphertext);
      let plaintext: Buffer | undefined;
      try {
        plaintext = Buffer.concat([partial, decipher.final()]);
        return aiResultSchema.parse(JSON.parse(plaintext.toString('utf8')));
      } finally {
        partial.fill(0);
        plaintext?.fill(0);
      }
    } catch {
      throw new AiPersistenceError('AI_RESULT_EXPIRED');
    }
  }
}
