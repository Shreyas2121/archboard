/** Numeric, bounded operational measurements; never pass board content, cookies, or update bytes. */
export function reportCollaborationMetric(
  event: string,
  values: Readonly<Record<string, number | string | boolean>>,
): void {
  console.info(JSON.stringify({ event, ...values }));
}
