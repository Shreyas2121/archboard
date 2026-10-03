import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { BetterAuthRuntime, configureAuthHttp } from './modules/auth/index.js';
import { configureCollaborationWebSockets } from './modules/collaboration/infrastructure/websocket/index.js';
import { loadApiConfig, PUBLIC_BIND_HOST } from './platform/config/index.js';
import { PrivacyLogger } from './platform/http/privacy-logger.js';
import { RuntimeAdmission } from './platform/lifecycle/runtime-admission.js';
import { ShutdownDeadline, PROCESS_SHUTDOWN_MS } from './platform/lifecycle/shutdown-deadline.js';
import {
  logStartupFailure,
  logStartupStage,
  type StartupStage,
} from './platform/lifecycle/startup-diagnostics.js';

let startupStage: StartupStage = 'configuration';
function enterStartupStage(stage: StartupStage): void {
  startupStage = stage;
  logStartupStage(stage);
}

async function bootstrap(): Promise<void> {
  enterStartupStage('configuration');
  const config = loadApiConfig(process.env);
  enterStartupStage('application_creation');
  const application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bodyParser: false,
    logger: new PrivacyLogger(),
    // Propagate initialization failures to the sanitized startup diagnostic below.
    abortOnError: false,
  });
  enterStartupStage('http_setup');
  configureCollaborationWebSockets(application);
  configureAuthHttp(application, application.get(BetterAuthRuntime), config);
  const admission = application.get(RuntimeAdmission);
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      const started = performance.now();
      admission.stop();
      console.info(JSON.stringify({ event: 'runtime.shutdown_started' }));
      void new ShutdownDeadline()
        .run(() => application.close(), PROCESS_SHUTDOWN_MS)
        .then(
          () => {
            console.info(
              JSON.stringify({
                event: 'runtime.shutdown_complete',
                durationMs: Math.round(performance.now() - started),
              }),
            );
            process.exit(0);
          },
          () => process.exit(1),
        );
    });

  enterStartupStage('application_initialization');
  await application.init();

  enterStartupStage('listen');
  await application.listen(config.port, PUBLIC_BIND_HOST);
}

void bootstrap().catch((error: unknown) => {
  logStartupFailure(startupStage, error);
  // Startup may already own a pool/worker; do not leave a failed process alive.
  process.exit(1);
});
