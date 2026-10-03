// Header policy is also consumed by the production host in P8-07.
export function contentSecurityPolicy(development = false) {
  const connections = development
    ? "'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
    : "'self'";
  return [
    "default-src 'self'",
    // Shiki's bundled Oniguruma WASM; JavaScript eval remains prohibited.
    "script-src 'self' 'wasm-unsafe-eval'",
    // React Flow geometry and Radix positioning require inline styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connections}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function shellSecurityHeaders(development = false) {
  return {
    'Content-Security-Policy': `${contentSecurityPolicy(development)}; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}
