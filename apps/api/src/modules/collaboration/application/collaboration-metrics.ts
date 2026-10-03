/** Numeric, bounded operational measurements; never pass board content, cookies, or update bytes. */
export function reportCollaborationMetric(
  event: string,
  values: Readonly<Record<string, number | string | boolean>>,
): void {
  try {
    console.info(JSON.stringify({ event, ...values }));
  } catch {
    // An unavailable diagnostic sink must not change commit/ACK/queue behavior.
  }
}
