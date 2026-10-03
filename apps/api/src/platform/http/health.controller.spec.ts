import type { DataSource } from 'typeorm';
import { HttpException } from '@nestjs/common';
import { apiErrorEnvelopeSchema } from '@archboard/contracts';
import type { CollaborationWriterLockService } from '../database/index.js';
import { RuntimeAdmission } from '../lifecycle/runtime-admission.js';
import { HealthController, ReadinessService } from './health.controller.js';

const HTTP_UNAVAILABLE = 503;

class TestReadiness extends ReadinessService {
  public compatible = true;
  public checks = 0;
  protected override async checkSchema(): Promise<boolean> {
    this.checks++;
    return this.compatible;
  }
}
function harness() {
  const admission = new RuntimeAdmission();
  admission.setOwnership(true);
  const source = { isInitialized: true };
  const ownership = { isReady: async () => true };
  const service = new TestReadiness(
    source as DataSource,
    ownership as CollaborationWriterLockService,
    admission,
  );
  return { source, ownership, admission, service };
}
it('admits only after startup schema validation; liveness does no DB or lock work', async () => {
  const { service, admission } = harness();
  const controller = new HealthController(service);
  expect(controller.live()).toEqual({ status: 'live' });
  expect(service.checks).toBe(0);
  expect(admission.accepting).toBe(false);
  await service.onApplicationBootstrap();
  expect(admission.accepting).toBe(true);
  expect(await controller.ready()).toEqual({ status: 'ready' });
});
it.each(['schema', 'ownership', 'database', 'shutdown'])(
  'fails readiness on %s without leaking diagnostics',
  async (failure) => {
    const { service, source, ownership, admission } = harness();
    await service.onApplicationBootstrap();
    if (failure === 'schema') service.compatible = false;
    if (failure === 'ownership') ownership.isReady = async () => false;
    if (failure === 'database') source.isInitialized = false;
    if (failure === 'shutdown') admission.stop();
    const controller = new HealthController(service);
    await expect(
      controller.ready().catch((error: unknown) => {
        if (!(error instanceof HttpException)) throw error;
        expect(error.getStatus()).toBe(HTTP_UNAVAILABLE);
        return apiErrorEnvelopeSchema.parse(error.getResponse());
      }),
    ).resolves.toMatchObject({
      error: { code: 'TEMPORARILY_UNAVAILABLE', message: 'Service temporarily unavailable.' },
    });
    expect(admission.accepting).toBe(false);
    expect(controller.live()).toEqual({ status: 'live' });
  },
);
it('a drain readiness probe does not revoke the schema fence for an admitted commit', async () => {
  const { service, admission } = harness();
  await service.onApplicationBootstrap();
  const finish = admission.beginTransaction();
  admission.stop();
  expect(await service.ready()).toBe(false);
  expect(() => admission.assertCanCommit()).not.toThrow();
  finish();
});
