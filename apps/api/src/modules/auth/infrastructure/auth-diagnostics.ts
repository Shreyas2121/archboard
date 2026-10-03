// Auth provider failures may contain OAuth state and invitation continuations.
// Retain the severity/event without serializing provider messages or arguments.
export function logAuthDiagnostic(level: string): void {
  const safeLevel = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'unknown';
  try {
    console.info(JSON.stringify({ event: 'auth.diagnostic', level: safeLevel }));
  } catch {
    // Provider diagnostics must not change auth behavior.
  }
}
