export function proofTarget(environment) {
  if (environment.P8_RUN_DATABASE_PROOF !== 'implementation-complete')
    throw new Error('Database proof is deferred.');
  const url = new URL(environment.P8_OPS_DATABASE_URL ?? '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/^[a-z][a-z0-9_]*_test$/.test(database) ||
    database !== environment.P8_OPS_CONFIRM_DATABASE ||
    url.searchParams.has('options')
  )
    throw new Error('An explicitly confirmed isolated local test database is required.');
  return url;
}
