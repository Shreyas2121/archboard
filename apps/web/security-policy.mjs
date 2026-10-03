// Header policy is also consumed by the production host in P8-07.
export function contentSecurityPolicy(development = false, connectionOrigins = []) {
  const configuredOrigins = connectionOrigins.map((origin) => {
    // Exact origins prevent environment values from injecting extra CSP directives.
    try {
      const url = new URL(origin);
      const secure = url.protocol === 'https:' || url.protocol === 'wss:';
      const local =
        development &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        (url.protocol === 'http:' || url.protocol === 'ws:');
      if (
        (!secure && !local) ||
        url.origin !== origin ||
        origin.includes('*') ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error();
      return origin;
    } catch {
      throw new Error(
        'CSP connection origins must be exact HTTPS/WSS origins (local development excepted).',
      );
    }
  });
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
    `connect-src ${[connections, ...new Set(configuredOrigins)].join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function shellSecurityHeaders(development = false, connectionOrigins = []) {
  return {
    'Content-Security-Policy': `${contentSecurityPolicy(development, connectionOrigins)}; frame-ancestors 'none'`,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  };
}
