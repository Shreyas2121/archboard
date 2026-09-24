export function safeReturnPath(value: unknown): '/boards' | null {
  return value === '/boards' ? '/boards' : null;
}
