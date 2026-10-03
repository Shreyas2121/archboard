import { ERROR_CODES } from '@archboard/contracts';

const EVENTS = new Set(
  [
    'connections',
    'access_reject',
    'admission_reject',
    'ack',
    'update_reject',
    'validation_reject',
    'validation_queue',
    'validation_worker',
    'compaction',
    'db_write',
    'room_queue',
  ].map((name) => `collaboration.${name}`),
);
const NUMERIC_FIELDS = new Set([
  'activeSockets',
  'activeRooms',
  'count',
  'latencyMs',
  'durationMs',
  'depth',
  'snapshotBytes',
]);
const SAFE_CODES = new Set<string>(Object.values(ERROR_CODES));
const SAFE_KINDS = new Set([
  'causal-gap',
  'document-invalid',
  'document-limit',
  'overloaded',
  'timeout',
  'worker-failure',
]);

/** Numeric, bounded operational measurements; never pass board content, cookies, or update bytes. */
export function reportCollaborationMetric(
  event: string,
  values: Readonly<Record<string, number | string | boolean>>,
): void {
  try {
    if (!EVENTS.has(event)) return;
    const safe: Record<string, number | string | boolean> = {};
    for (const [key, value] of Object.entries(values)) {
      if (
        NUMERIC_FIELDS.has(key) &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0
      )
        safe[key] = value;
      else if (key === 'duplicate' && typeof value === 'boolean') safe[key] = value;
      else if (key === 'code' && typeof value === 'string' && SAFE_CODES.has(value))
        safe[key] = value;
      else if (key === 'kind' && typeof value === 'string' && SAFE_KINDS.has(value))
        safe[key] = value;
    }
    console.info(JSON.stringify({ event, ...safe }));
  } catch {
    // An unavailable diagnostic sink must not change commit/ACK/queue behavior.
  }
}
