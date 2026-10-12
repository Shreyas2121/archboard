import { randomUUID } from 'node:crypto';
import type { AiPolicy } from './operator-policy.js';
import { AiAdmissionError } from './admission-service.js';
import { aiActorSchema } from './persistence.js';
export const AI_CONNECTION_GATE = Symbol('AI_CONNECTION_GATE');
const MAX_CONNECTIONS = 256;
/** Cheap, bounded connection admission for the current single-writer runtime.
 * C08 must release the lease on every close/error/shutdown; this is not paid work. */
export class AiConnectionGate {
  private readonly leases = new Map<string, string>();
  public constructor(private readonly policy: AiPolicy | null) {}
  public acquire(namespace: string, actor: string): () => void {
    if (!aiActorSchema.safeParse(actor).success)
      throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    if (!this.policy) throw new AiAdmissionError('AI_DISABLED');
    if (namespace !== this.policy.deploymentNamespace)
      throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    const actorCount = [...this.leases.values()].filter((value) => value === actor).length;
    if (
      !this.policy.localUnlimited &&
      (this.leases.size >= MAX_CONNECTIONS ||
        actorCount >= this.policy.limits.sseConnectionsPerActor)
    )
      throw new AiAdmissionError('RATE_LIMITED');
    const token = randomUUID();
    this.leases.set(token, actor);
    return () => {
      this.leases.delete(token);
    };
  }
}
