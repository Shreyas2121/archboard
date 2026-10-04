import {
  AiPersistenceError,
  aiMoneySchema,
  aiRunSnapshotSchema,
  type AiIntent,
  type AiRunSnapshot,
} from './persistence.js';
import { normalizedUsageSchema, type NormalizedUsage } from './provider.js';
const ZERO = 0n;
const ONE = 1n;
const MILLION = 1_000_000n;
export function checkedMoney(value: bigint): string {
  const result = value.toString();
  if (!aiMoneySchema.safeParse(result).success)
    throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
  return result;
}
const charge = (tokens: bigint, price: string) =>
  (tokens * BigInt(price) + MILLION - ONE) / MILLION;
export function estimateAiReservation(
  input: AiRunSnapshot,
  retries: { repairs: number; rejectionRetries: number },
): AiIntent['reservation'] {
  const parsed = aiRunSnapshotSchema.safeParse(input);
  if (!parsed.success) throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
  const snapshot = parsed.data;
  if (
    ![retries.repairs, retries.rejectionRetries].every((value) => value === 0 || value === 1) ||
    snapshot.prices.uncachedInputMicroUsdPerMillion === '0' ||
    snapshot.prices.outputMicroUsdPerMillion === '0'
  )
    throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
  const attempts = 1 + retries.repairs + retries.rejectionRetries;
  const inputBound = BigInt(snapshot.maximumInputTokens);
  const outputBound = BigInt(snapshot.maximumOutputTokens);
  const inputPrice = [
    snapshot.prices.uncachedInputMicroUsdPerMillion,
    snapshot.prices.cacheReadMicroUsdPerMillion,
    ...snapshot.prices.cacheWrites.map((entry) => entry.microUsdPerMillion),
  ]
    .map(BigInt)
    .reduce((a, b) => (a > b ? a : b), ZERO);
  const perAttempt =
    charge(inputBound, inputPrice.toString()) +
    BigInt(
      Math.min(
        snapshot.maximumInputTokens,
        [
          snapshot.prices.uncachedInputMicroUsdPerMillion,
          snapshot.prices.cacheReadMicroUsdPerMillion,
          ...snapshot.prices.cacheWrites.map((entry) => entry.microUsdPerMillion),
        ].filter((rate) => BigInt(rate) > ZERO).length,
      ) - 1,
    ) +
    charge(outputBound, snapshot.prices.outputMicroUsdPerMillion) +
    (snapshot.prices.separateReasoningMicroUsdPerMillion === null
      ? ZERO
      : charge(outputBound, snapshot.prices.separateReasoningMicroUsdPerMillion));
  return {
    maximumMicroUsd: checkedMoney(perAttempt * BigInt(attempts)),
    inputTokens: checkedMoney(inputBound * BigInt(attempts)),
    outputTokens: checkedMoney(
      outputBound *
        BigInt(attempts) *
        (snapshot.prices.separateReasoningMicroUsdPerMillion === null ? ONE : ONE + ONE),
    ),
    maximumAttempts: attempts,
  };
}
export function priceAiUsage(snapshot: AiRunSnapshot, input: NormalizedUsage): string {
  const parsed = normalizedUsageSchema.safeParse(input);
  if (!parsed.success || parsed.data.status !== 'known')
    throw new AiPersistenceError('AI_OUTCOME_UNKNOWN');
  const usage = parsed.data;
  let cost =
    charge(BigInt(usage.uncachedInputTokens), snapshot.prices.uncachedInputMicroUsdPerMillion) +
    charge(BigInt(usage.cacheReadInputTokens), snapshot.prices.cacheReadMicroUsdPerMillion) +
    charge(BigInt(usage.outputTokens), snapshot.prices.outputMicroUsdPerMillion);
  for (const entry of usage.cacheWriteInputTokens) {
    const price = snapshot.prices.cacheWrites.find((rate) => rate.writeClass === entry.writeClass);
    if (!price) throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
    cost += charge(BigInt(entry.tokens), price.microUsdPerMillion);
  }
  if (usage.separatelyBilledReasoningTokens > 0) {
    if (snapshot.prices.separateReasoningMicroUsdPerMillion === null)
      throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
    cost += charge(
      BigInt(usage.separatelyBilledReasoningTokens),
      snapshot.prices.separateReasoningMicroUsdPerMillion,
    );
  }
  return checkedMoney(cost);
}
