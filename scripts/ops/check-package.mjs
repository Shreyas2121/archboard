import { packageSources, validatePackage } from './package-policy.mjs';
try {
  validatePackage(await packageSources());
  process.stdout.write(
    'PASS Compose syntax and package/source security policy; no daemon, DB or browser started. Native Caddy validation is separate.\n',
  );
} catch {
  process.stderr.write(
    'FAIL package/source policy; configured values and parser output withheld.\n',
  );
  process.exitCode = 1;
}
