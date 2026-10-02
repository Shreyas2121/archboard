import {
  portableGraphProjectionSchema,
  type GraphNode,
  type ComponentContent,
} from '@archboard/contracts';
import { fixtureId, FIXTURE_NAMESPACES } from '../ids.js';

const EVENT = {
  PRODUCER: 201,
  QUEUE: 202,
  WORKER: 203,
  DATABASE: 204,
  NOTIFICATION: 205,
  RETRY: 206,
} as const;
const SERVICE = {
  GATEWAY: 301,
  IDENTITY: 302,
  APPLICATION: 303,
  DATABASE: 304,
  SCHEMA: 305,
  OWNERSHIP: 306,
} as const;
const CARD_ROW = 100;
const EVENT_QUEUE_X = 380;
const EVENT_WORKER_X = 760;
const EVENT_OUTPUT_X = 1140;
const NOTIFICATION_Y = 300;
const IDENTITY_X = 400;
const IDENTITY_Y = -200;
const APPLICATION_X = 800;
const DATABASE_X = 1200;
const FINAL_STEP_ORDER = 2;

const nodeId = (n: number) => fixtureId(FIXTURE_NAMESPACES.NODE, n);
function component(
  n: number,
  title: string,
  category: ComponentContent['category'],
  technology: string,
  x: number,
  y: number,
): GraphNode {
  return {
    id: nodeId(n),
    kind: 'component',
    title,
    color: 'blue',
    position: { x, y },
    size: { width: 240, height: 160 },
    content: { category, technology, description: title, externalUrl: null },
  };
}
function edge(n: number, source: number, target: number, label: string, protocol: string) {
  return {
    id: fixtureId(FIXTURE_NAMESPACES.EDGE, n),
    sourceId: nodeId(source),
    targetId: nodeId(target),
    sourceHandle: 'right',
    targetHandle: 'left',
    label,
    protocol,
    direction: 'forward',
    style: 'solid',
  };
}
function step(
  n: number,
  order: number,
  title: string,
  notes: string,
  nodes: number[],
  edges: number[],
) {
  return {
    id: fixtureId(FIXTURE_NAMESPACES.STEP, n),
    order,
    title,
    notes,
    nodeIds: nodes.map(nodeId),
    edgeIds: edges.map((id) => fixtureId(FIXTURE_NAMESPACES.EDGE, id)),
    rect: { x: -60, y: -320, width: 1640, height: 1000 },
  };
}

export const eventProcessingTemplate = portableGraphProjectionSchema.parse({
  schemaVersion: 1,
  nodes: [
    component(EVENT.PRODUCER, 'Producer service', 'service', 'Node.js', 0, CARD_ROW),
    component(EVENT.QUEUE, 'Queue', 'queue', 'RabbitMQ', EVENT_QUEUE_X, CARD_ROW),
    component(EVENT.WORKER, 'Worker', 'service', 'Node.js', EVENT_WORKER_X, CARD_ROW),
    component(EVENT.DATABASE, 'Database', 'database', 'PostgreSQL', EVENT_OUTPUT_X, 0),
    component(
      EVENT.NOTIFICATION,
      'External notification service',
      'external',
      'Email provider',
      EVENT_OUTPUT_X,
      NOTIFICATION_Y,
    ),
    {
      id: nodeId(EVENT.RETRY),
      kind: 'note',
      title: 'Retry behavior',
      color: 'amber',
      position: { x: EVENT_QUEUE_X, y: 440 },
      size: { width: 580, height: 180 },
      content: {
        body: 'Acknowledge after persistence. Retry transient failures with exponential backoff. Deduplicate event IDs before notifications; send exhausted retries to a dead-letter queue.',
      },
    },
  ],
  edges: [
    edge(EVENT.PRODUCER, EVENT.PRODUCER, EVENT.QUEUE, 'Publish event', 'AMQP'),
    edge(EVENT.QUEUE, EVENT.QUEUE, EVENT.WORKER, 'Deliver event', 'AMQP'),
    edge(EVENT.WORKER, EVENT.WORKER, EVENT.DATABASE, 'Persist result', 'SQL'),
    edge(EVENT.DATABASE, EVENT.WORKER, EVENT.NOTIFICATION, 'Send notification', 'HTTPS'),
  ],
  boundaries: [],
  steps: [
    step(
      EVENT.PRODUCER,
      0,
      'Publish an event',
      'The producer publishes a durable event to the queue.',
      [EVENT.PRODUCER, EVENT.QUEUE],
      [EVENT.PRODUCER],
    ),
    step(
      EVENT.QUEUE,
      1,
      'Process and persist',
      'Persist the result before acknowledging delivery.',
      [EVENT.QUEUE, EVENT.WORKER, EVENT.DATABASE],
      [EVENT.QUEUE, EVENT.WORKER],
    ),
    step(
      EVENT.WORKER,
      FINAL_STEP_ORDER,
      'Notify and retry safely',
      'Use event IDs for idempotency and bounded retries.',
      [EVENT.WORKER, EVENT.NOTIFICATION, EVENT.RETRY],
      [EVENT.DATABASE],
    ),
  ],
});

export const serviceBoundaryTemplate = portableGraphProjectionSchema.parse({
  schemaVersion: 1,
  nodes: [
    component(SERVICE.GATEWAY, 'API gateway', 'service', 'Envoy', 0, CARD_ROW),
    component(SERVICE.IDENTITY, 'Identity service', 'service', 'OIDC', IDENTITY_X, IDENTITY_Y),
    component(
      SERVICE.APPLICATION,
      'Application service',
      'service',
      'Node.js',
      APPLICATION_X,
      CARD_ROW,
    ),
    component(SERVICE.DATABASE, 'Database', 'database', 'PostgreSQL', DATABASE_X, CARD_ROW),
    {
      id: nodeId(SERVICE.SCHEMA),
      kind: 'schema',
      title: 'Application schema',
      color: 'violet',
      position: { x: DATABASE_X, y: EVENT_QUEUE_X },
      size: { width: 320, height: 200 },
      content: {
        body: 'orders\n  id uuid PRIMARY KEY\n  actor_id uuid NOT NULL\n  status text NOT NULL\n  created_at timestamptz NOT NULL',
      },
    },
    {
      id: nodeId(SERVICE.OWNERSHIP),
      kind: 'note',
      title: 'Data ownership',
      color: 'amber',
      position: { x: 0, y: 460 },
      size: { width: 640, height: 160 },
      content: {
        body: 'Identity owns credentials and tokens. The application owns orders and its database. Cross-boundary access uses service APIs; callers never write another service database directly.',
      },
    },
  ],
  edges: [
    edge(SERVICE.GATEWAY, SERVICE.GATEWAY, SERVICE.IDENTITY, 'Validate identity', 'OIDC'),
    edge(SERVICE.IDENTITY, SERVICE.GATEWAY, SERVICE.APPLICATION, 'Authorized request', 'HTTPS'),
    edge(SERVICE.APPLICATION, SERVICE.APPLICATION, SERVICE.DATABASE, 'Read/write orders', 'SQL'),
  ],
  boundaries: [
    {
      id: fixtureId(FIXTURE_NAMESPACES.BOUNDARY, SERVICE.GATEWAY),
      title: 'Identity ownership',
      color: 'teal',
      rect: { x: 350, y: -280, width: 340, height: 320 },
    },
    {
      id: fixtureId(FIXTURE_NAMESPACES.BOUNDARY, SERVICE.IDENTITY),
      title: 'Application ownership',
      color: 'violet',
      rect: { x: 750, y: 20, width: 820, height: 610 },
    },
  ],
  steps: [
    step(
      SERVICE.GATEWAY,
      0,
      'Authenticate at the gateway',
      'Validate identity through the identity service API.',
      [SERVICE.GATEWAY, SERVICE.IDENTITY],
      [SERVICE.GATEWAY],
    ),
    step(
      SERVICE.IDENTITY,
      1,
      'Cross the service boundary',
      'Forward authorized requests; ownership stays with each service.',
      [SERVICE.GATEWAY, SERVICE.APPLICATION, SERVICE.OWNERSHIP],
      [SERVICE.IDENTITY],
    ),
    step(
      SERVICE.APPLICATION,
      FINAL_STEP_ORDER,
      'Persist owned data',
      'Only the application writes its schema; credentials stay with identity.',
      [SERVICE.APPLICATION, SERVICE.DATABASE, SERVICE.SCHEMA],
      [SERVICE.APPLICATION],
    ),
  ],
});
