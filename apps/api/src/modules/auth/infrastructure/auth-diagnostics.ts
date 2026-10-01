// Auth provider failures may contain OAuth state and invitation continuations.
// Retain the severity/event without serializing provider messages or arguments.
export function logAuthDiagnostic(level: string): void {
  console.info(JSON.stringify({ event: 'auth.diagnostic', level }));
}
