export const BACKEND_SECRET_NAMES = [
  'DATABASE_URL',
  'DATABASE_DIRECT_URL',
  'DATABASE_URL_UNPOOLED',
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_SECRET',
];

// Return a count only. Never include matched values, payloads, paths or excerpts.
export function privateArtifactFindings(contents, canaries = []) {
  const patterns = [
    /postgres(?:ql)?:\/\/[^\s<>"']+:[^\s<>"']+@/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,})\b/,
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /\/invite\/[A-Za-z0-9_-]{32,}/,
    /\b(?:cookie|set-cookie|authorization)\s*[:=]\s*["']?(?:Bearer\s+\S+|[^\s"']*session[^\s"']*=\S+)/i,
  ];
  return (
    patterns.filter((pattern) => pattern.test(contents)).length +
    canaries.filter((value) => value.length >= 8 && contents.includes(value)).length
  );
}
