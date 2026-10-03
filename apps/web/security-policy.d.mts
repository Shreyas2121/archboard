export function contentSecurityPolicy(
  development?: boolean,
  connectionOrigins?: readonly string[],
): string;
export function shellSecurityHeaders(
  development?: boolean,
  connectionOrigins?: readonly string[],
): Record<string, string>;
