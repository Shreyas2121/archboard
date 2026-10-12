import {
  aiCreateRunSchema,
  aiResultForRequestSchema,
  type AiCreateRun,
} from '@archboard/contracts';
import type { AiPrivateIdentity } from './private-identity.js';
import type { AiProviderRegistry } from './provider-registry.js';
import type { AiRunCoordinator } from './run-coordinator.js';

/** Server-owned construction is the route-facing entry point. Clients never
 * supply trusted digests, models, provider requests or reservation amounts. */
export class AiRunApplication {
  public constructor(
    private readonly identities: AiPrivateIdentity,
    private readonly registry: AiProviderRegistry,
    private readonly runs: AiRunCoordinator,
  ) {}
  public async create(actor: string, key: string, body: AiCreateRun) {
    const reviewed = aiCreateRunSchema.parse(body);
    const resolved = this.registry.resolve();
    const prepared = this.identities.prepare(actor, key, reviewed, resolved.configuration);
    const validation = aiResultForRequestSchema(reviewed);
    const admitted = await this.runs.start(
      prepared.intent,
      resolved.adapter,
      prepared.request,
      (result) => validation.parse(result),
    );
    // Admission already authorized the target under its board lock. A pending
    // acknowledgment discloses no private result and must not race the new worker
    // for a second transaction. Terminal/cache content still reauthorizes below.
    if (['pending-admission', 'admitted', 'dispatching'].includes(admitted.run.phase))
      return { ...admitted, result: null, content: 'pending' as const };
    // Both cache returns and freshly completed results require current authority.
    const snapshot = await this.runs.read(
      prepared.intent.deploymentNamespace,
      actor,
      admitted.run.id,
    );
    return { source: admitted.source, ...snapshot };
  }
}
