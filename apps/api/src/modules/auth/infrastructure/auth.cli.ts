import { loadApiConfig } from '../../../platform/config/index.js';
import { BetterAuthRuntime } from './better-auth.runtime.js';

const runtime = new BetterAuthRuntime(loadApiConfig(process.env));

export const auth = runtime.auth;
