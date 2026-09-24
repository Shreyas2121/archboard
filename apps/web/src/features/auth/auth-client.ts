import { createAuthClient } from 'better-auth/client';

import { loadWebConfig } from '@/platform/config';

export const authClient = createAuthClient({
  baseURL: loadWebConfig(import.meta.env).apiOrigin,
  fetchOptions: { credentials: 'include' },
});
