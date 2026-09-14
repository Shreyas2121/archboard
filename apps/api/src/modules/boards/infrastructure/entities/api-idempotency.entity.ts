import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'api_idempotency' })
export class ApiIdempotencyEntity {
  @PrimaryColumn({ name: 'actor_user_id', type: 'text' })
  actorUserId!: string;

  @PrimaryColumn({ type: 'text' })
  operation!: string;

  @PrimaryColumn({ type: 'uuid' })
  key!: string;

  @Column({ name: 'request_hash', type: 'bytea' })
  requestHash!: Buffer;

  @Column({ name: 'response_status', type: 'integer' })
  responseStatus!: number;

  @Column({ name: 'response_json', type: 'jsonb' })
  responseJson!: unknown;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
