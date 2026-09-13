import {
  BOARD_ROLES,
  CLIENT_EVENT_NAMES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_BOUNDARY_TITLE_CHARACTERS,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_COMPONENT_DESCRIPTION_CHARACTERS,
  MAX_CONTENT_BODY_CHARACTERS,
  MAX_DRAG_PREVIEW_POSITIONS,
  MAX_EDGE_LABEL_CHARACTERS,
  MAX_EDGE_PROTOCOL_CHARACTERS,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_EXTERNAL_URL_CHARACTERS,
  MAX_GRAPH_COORDINATE,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_NODE_HEIGHT,
  MAX_NODE_TITLE_CHARACTERS,
  MAX_NODE_WIDTH,
  MAX_PRESENCE_SELECTED_IDS,
  MAX_RECT_DIMENSION,
  MAX_STEP_NOTES_CHARACTERS,
  MAX_STEP_ORDER,
  MAX_STEP_REFERENCES,
  MAX_STEP_TITLE_CHARACTERS,
  MAX_TECHNOLOGY_CHARACTERS,
  MAX_WS_FRAME_BYTES,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  MIN_STEP_ORDER,
  PROTOCOL_VERSION,
  SERVER_EVENT_NAMES,
  SERVER_SEQUENCE_ZERO,
} from '@archboard/contracts';

import { allEntityGraphFixture, buildGraphFixture, minimalGraphFixture } from '../graph/index.js';
import { FIXED_IDS, FIXTURE_NAMESPACES, fixtureId } from '../ids.js';

const BASE64_BYTES_PER_BLOCK = 3;
const BASE64_ZERO_BLOCK = 'AAAA';
const BASE64_ONE_BYTE_REMAINDER = 'AA==';
const BASE64_TWO_BYTE_REMAINDER = 'AAA=';
const EXTERNAL_URL_PREFIX = 'https://example.com/';

export type ContractFixtureSchema = 'graph' | 'client-message' | 'server-message';

export interface InvalidContractFixture {
  readonly name: string;
  readonly schema: ContractFixtureSchema;
  readonly expectedPath: string;
  readonly candidate: unknown;
}

export interface RawByteLimitFixture {
  readonly name: string;
  readonly maximumBytes: number;
  readonly byteLength: number;
}

export const rawWebSocketFrameOverLimitFixture: RawByteLimitFixture = {
  name: 'websocket-frame-one-over-limit',
  maximumBytes: MAX_WS_FRAME_BYTES,
  byteLength: MAX_WS_FRAME_BYTES + 1,
};

export function zeroBytesAsCanonicalBase64(byteLength: number): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error('Base64 fixture byte length must be a non-negative safe integer.');
  }

  const completeBlocks = Math.floor(byteLength / BASE64_BYTES_PER_BLOCK);
  const remainingBytes = byteLength % BASE64_BYTES_PER_BLOCK;
  const remainder =
    remainingBytes === 0
      ? ''
      : remainingBytes === 1
        ? BASE64_ONE_BYTE_REMAINDER
        : BASE64_TWO_BYTE_REMAINDER;

  return BASE64_ZERO_BLOCK.repeat(completeBlocks) + remainder;
}

function oversizedExternalUrl(): string {
  return `${EXTERNAL_URL_PREFIX}${'x'.repeat(MAX_EXTERNAL_URL_CHARACTERS - EXTERNAL_URL_PREFIX.length + 1)}`;
}

function createReadyMessage(snapshotBase64: string): unknown {
  return {
    event: SERVER_EVENT_NAMES.READY,
    data: {
      role: BOARD_ROLES.EDITOR,
      latestSeq: SERVER_SEQUENCE_ZERO,
      snapshotBase64,
      connectionId: FIXED_IDS.CLIENT_A,
      limits: {
        maxClientUpdateBytes: MAX_CLIENT_UPDATE_BYTES,
        maxEncodedYjsStateBytes: MAX_ENCODED_YJS_STATE_BYTES,
        maxWebSocketFrameBytes: MAX_WS_FRAME_BYTES,
        maxLiveNodes: MAX_LIVE_NODES,
        maxLiveEdges: MAX_LIVE_EDGES,
        maxLiveBoundaries: MAX_LIVE_BOUNDARIES,
        maxLivePresentationSteps: MAX_LIVE_PRESENTATION_STEPS,
        maxPresenceSelectedIds: MAX_PRESENCE_SELECTED_IDS,
      },
    },
  };
}

export function createInvalidContractFixtures(): readonly InvalidContractFixture[] {
  const componentNode = minimalGraphFixture.nodes[0]!;
  const codeNode = allEntityGraphFixture.nodes[1]!;
  const edge = minimalGraphFixture.edges[0]!;
  const boundary = allEntityGraphFixture.boundaries[0]!;
  const step = allEntityGraphFixture.steps[0]!;
  const combinedReferenceNodeIds = Array.from({ length: MAX_STEP_REFERENCES }, (_unused, ordinal) =>
    fixtureId(FIXTURE_NAMESPACES.NODE, ordinal),
  );
  const overLimitPresenceIds = Array.from(
    { length: MAX_PRESENCE_SELECTED_IDS + 1 },
    (_unused, ordinal) => fixtureId(FIXTURE_NAMESPACES.NODE, ordinal),
  );
  const overLimitDragPositions = Array.from(
    { length: MAX_DRAG_PREVIEW_POSITIONS + 1 },
    (_unused, ordinal) => ({
      id: fixtureId(FIXTURE_NAMESPACES.NODE, ordinal),
      position: { x: ordinal, y: ordinal },
    }),
  );

  return [
    {
      name: 'unknown-projection-field',
      schema: 'graph',
      expectedPath: '',
      candidate: { ...minimalGraphFixture, metadata: {} },
    },
    {
      name: 'unsupported-schema-version',
      schema: 'graph',
      expectedPath: 'schemaVersion',
      candidate: { ...minimalGraphFixture, schemaVersion: GRAPH_SCHEMA_VERSION + 1 },
    },
    {
      name: 'invalid-application-id',
      schema: 'graph',
      expectedPath: 'nodes.0.id',
      candidate: { ...minimalGraphFixture, nodes: [{ ...componentNode, id: 'node-a' }] },
    },
    {
      name: 'unknown-nested-field',
      schema: 'graph',
      expectedPath: 'nodes.0',
      candidate: { ...minimalGraphFixture, nodes: [{ ...componentNode, metadata: {} }] },
    },
    {
      name: 'unknown-node-enum',
      schema: 'graph',
      expectedPath: 'nodes.0.color',
      candidate: { ...minimalGraphFixture, nodes: [{ ...componentNode, color: 'orange' }] },
    },
    {
      name: 'mismatched-node-content',
      schema: 'graph',
      expectedPath: 'nodes.0.content',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, kind: 'note', content: componentNode.content }],
      },
    },
    {
      name: 'unknown-component-category',
      schema: 'graph',
      expectedPath: 'nodes.0.content.category',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          { ...componentNode, content: { ...componentNode.content, category: 'application' } },
        ],
      },
    },
    {
      name: 'unknown-code-language',
      schema: 'graph',
      expectedPath: 'nodes.0.content.language',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...codeNode, content: { ...codeNode.content, language: 'python' } }],
      },
    },
    {
      name: 'unknown-edge-handle',
      schema: 'graph',
      expectedPath: 'edges.0.sourceHandle',
      candidate: { ...minimalGraphFixture, edges: [{ ...edge, sourceHandle: 'center' }] },
    },
    {
      name: 'unknown-edge-direction',
      schema: 'graph',
      expectedPath: 'edges.0.direction',
      candidate: { ...minimalGraphFixture, edges: [{ ...edge, direction: 'backward' }] },
    },
    {
      name: 'unknown-edge-style',
      schema: 'graph',
      expectedPath: 'edges.0.style',
      candidate: { ...minimalGraphFixture, edges: [{ ...edge, style: 'dotted' }] },
    },
    {
      name: 'malformed-nested-coordinate',
      schema: 'graph',
      expectedPath: 'nodes.0.position.x',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, position: { ...componentNode.position, x: 'left' } }],
      },
    },
    {
      name: 'non-finite-coordinate',
      schema: 'graph',
      expectedPath: 'nodes.0.position.x',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, position: { ...componentNode.position, x: Number.NaN } }],
      },
    },
    {
      name: 'coordinate-one-over-limit',
      schema: 'graph',
      expectedPath: 'nodes.0.position.x',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          {
            ...componentNode,
            position: { ...componentNode.position, x: MAX_GRAPH_COORDINATE + 1 },
          },
        ],
      },
    },
    {
      name: 'coordinate-one-under-negative-limit',
      schema: 'graph',
      expectedPath: 'nodes.0.position.y',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          {
            ...componentNode,
            position: { ...componentNode.position, y: -MAX_GRAPH_COORDINATE - 1 },
          },
        ],
      },
    },
    {
      name: 'node-title-one-over-limit',
      schema: 'graph',
      expectedPath: 'nodes.0.title',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, title: 'x'.repeat(MAX_NODE_TITLE_CHARACTERS + 1) }],
      },
    },
    {
      name: 'component-description-one-over-limit',
      schema: 'graph',
      expectedPath: 'nodes.0.content.description',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          {
            ...componentNode,
            content: {
              ...componentNode.content,
              description: 'x'.repeat(MAX_COMPONENT_DESCRIPTION_CHARACTERS + 1),
            },
          },
        ],
      },
    },
    {
      name: 'technology-one-over-limit',
      schema: 'graph',
      expectedPath: 'nodes.0.content.technology',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          {
            ...componentNode,
            content: {
              ...componentNode.content,
              technology: 'x'.repeat(MAX_TECHNOLOGY_CHARACTERS + 1),
            },
          },
        ],
      },
    },
    {
      name: 'external-url-one-over-limit',
      schema: 'graph',
      expectedPath: 'nodes.0.content.externalUrl',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          {
            ...componentNode,
            content: { ...componentNode.content, externalUrl: oversizedExternalUrl() },
          },
        ],
      },
    },
    {
      name: 'unsupported-external-url-scheme',
      schema: 'graph',
      expectedPath: 'nodes.0.content.externalUrl',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          {
            ...componentNode,
            content: { ...componentNode.content, externalUrl: 'javascript:alert(1)' },
          },
        ],
      },
    },
    {
      name: 'content-body-one-over-limit',
      schema: 'graph',
      expectedPath: 'nodes.0.content.body',
      candidate: {
        ...minimalGraphFixture,
        nodes: [
          {
            ...codeNode,
            content: { ...codeNode.content, body: 'x'.repeat(MAX_CONTENT_BODY_CHARACTERS + 1) },
          },
        ],
      },
    },
    {
      name: 'node-width-one-under-minimum',
      schema: 'graph',
      expectedPath: 'nodes.0.size.width',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, size: { ...componentNode.size, width: MIN_NODE_WIDTH - 1 } }],
      },
    },
    {
      name: 'node-width-one-over-maximum',
      schema: 'graph',
      expectedPath: 'nodes.0.size.width',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, size: { ...componentNode.size, width: MAX_NODE_WIDTH + 1 } }],
      },
    },
    {
      name: 'node-height-one-under-minimum',
      schema: 'graph',
      expectedPath: 'nodes.0.size.height',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, size: { ...componentNode.size, height: MIN_NODE_HEIGHT - 1 } }],
      },
    },
    {
      name: 'node-height-one-over-maximum',
      schema: 'graph',
      expectedPath: 'nodes.0.size.height',
      candidate: {
        ...minimalGraphFixture,
        nodes: [{ ...componentNode, size: { ...componentNode.size, height: MAX_NODE_HEIGHT + 1 } }],
      },
    },
    {
      name: 'edge-label-one-over-limit',
      schema: 'graph',
      expectedPath: 'edges.0.label',
      candidate: {
        ...minimalGraphFixture,
        edges: [{ ...edge, label: 'x'.repeat(MAX_EDGE_LABEL_CHARACTERS + 1) }],
      },
    },
    {
      name: 'edge-protocol-one-over-limit',
      schema: 'graph',
      expectedPath: 'edges.0.protocol',
      candidate: {
        ...minimalGraphFixture,
        edges: [{ ...edge, protocol: 'x'.repeat(MAX_EDGE_PROTOCOL_CHARACTERS + 1) }],
      },
    },
    {
      name: 'boundary-title-one-over-limit',
      schema: 'graph',
      expectedPath: 'boundaries.0.title',
      candidate: {
        ...allEntityGraphFixture,
        boundaries: [{ ...boundary, title: 'x'.repeat(MAX_BOUNDARY_TITLE_CHARACTERS + 1) }],
      },
    },
    {
      name: 'rectangle-zero-dimension',
      schema: 'graph',
      expectedPath: 'boundaries.0.rect.width',
      candidate: {
        ...allEntityGraphFixture,
        boundaries: [{ ...boundary, rect: { ...boundary.rect, width: 0 } }],
      },
    },
    {
      name: 'rectangle-one-over-limit',
      schema: 'graph',
      expectedPath: 'boundaries.0.rect.height',
      candidate: {
        ...allEntityGraphFixture,
        boundaries: [{ ...boundary, rect: { ...boundary.rect, height: MAX_RECT_DIMENSION + 1 } }],
      },
    },
    {
      name: 'step-title-one-over-limit',
      schema: 'graph',
      expectedPath: 'steps.0.title',
      candidate: {
        ...allEntityGraphFixture,
        steps: [{ ...step, title: 'x'.repeat(MAX_STEP_TITLE_CHARACTERS + 1) }],
      },
    },
    {
      name: 'step-notes-one-over-limit',
      schema: 'graph',
      expectedPath: 'steps.0.notes',
      candidate: {
        ...allEntityGraphFixture,
        steps: [{ ...step, notes: 'x'.repeat(MAX_STEP_NOTES_CHARACTERS + 1) }],
      },
    },
    {
      name: 'step-order-one-under-limit',
      schema: 'graph',
      expectedPath: 'steps.0.order',
      candidate: { ...allEntityGraphFixture, steps: [{ ...step, order: MIN_STEP_ORDER - 1 }] },
    },
    {
      name: 'step-order-one-over-limit',
      schema: 'graph',
      expectedPath: 'steps.0.order',
      candidate: { ...allEntityGraphFixture, steps: [{ ...step, order: MAX_STEP_ORDER + 1 }] },
    },
    {
      name: 'step-references-one-over-limit',
      schema: 'graph',
      expectedPath: 'steps.0.nodeIds',
      candidate: {
        ...allEntityGraphFixture,
        steps: [
          {
            ...step,
            nodeIds: combinedReferenceNodeIds,
            edgeIds: [fixtureId(FIXTURE_NAMESPACES.EDGE, MAX_STEP_REFERENCES + 1)],
          },
        ],
      },
    },
    {
      name: 'live-nodes-one-over-limit',
      schema: 'graph',
      expectedPath: 'nodes',
      candidate: buildGraphFixture({
        nodeCount: MAX_LIVE_NODES + 1,
        edgeCount: 0,
        boundaryCount: 0,
        stepCount: 0,
      }),
    },
    {
      name: 'live-edges-one-over-limit',
      schema: 'graph',
      expectedPath: 'edges',
      candidate: buildGraphFixture({
        nodeCount: 2,
        edgeCount: MAX_LIVE_EDGES + 1,
        boundaryCount: 0,
        stepCount: 0,
      }),
    },
    {
      name: 'live-boundaries-one-over-limit',
      schema: 'graph',
      expectedPath: 'boundaries',
      candidate: buildGraphFixture({
        nodeCount: 0,
        edgeCount: 0,
        boundaryCount: MAX_LIVE_BOUNDARIES + 1,
        stepCount: 0,
      }),
    },
    {
      name: 'live-steps-one-over-limit',
      schema: 'graph',
      expectedPath: 'steps',
      candidate: buildGraphFixture({
        nodeCount: 0,
        edgeCount: 0,
        boundaryCount: 0,
        stepCount: MAX_LIVE_PRESENTATION_STEPS + 1,
      }),
    },
    {
      name: 'duplicate-entity-id',
      schema: 'graph',
      expectedPath: 'nodes',
      candidate: { ...minimalGraphFixture, nodes: [componentNode, componentNode] },
    },
    {
      name: 'client-update-one-over-decoded-byte-limit',
      schema: 'client-message',
      expectedPath: 'data.updateBase64',
      candidate: {
        event: CLIENT_EVENT_NAMES.UPDATE,
        data: {
          updateId: FIXED_IDS.UPDATE_A,
          updateBase64: zeroBytesAsCanonicalBase64(MAX_CLIENT_UPDATE_BYTES + 1),
        },
      },
    },
    {
      name: 'snapshot-one-over-decoded-byte-limit',
      schema: 'server-message',
      expectedPath: 'data.snapshotBase64',
      candidate: createReadyMessage(zeroBytesAsCanonicalBase64(MAX_ENCODED_YJS_STATE_BYTES + 1)),
    },
    {
      name: 'presence-selection-one-over-limit',
      schema: 'client-message',
      expectedPath: 'data.selectedIds',
      candidate: {
        event: CLIENT_EVENT_NAMES.PRESENCE,
        data: { cursor: null, selectedIds: overLimitPresenceIds, dragPreview: null },
      },
    },
    {
      name: 'drag-preview-one-over-limit',
      schema: 'client-message',
      expectedPath: 'data.dragPreview.positions',
      candidate: {
        event: CLIENT_EVENT_NAMES.PRESENCE,
        data: {
          cursor: null,
          selectedIds: [],
          dragPreview: { positions: overLimitDragPositions },
        },
      },
    },
    {
      name: 'unsupported-protocol-version',
      schema: 'client-message',
      expectedPath: 'data.protocolVersion',
      candidate: {
        event: CLIENT_EVENT_NAMES.HELLO,
        data: {
          protocolVersion: PROTOCOL_VERSION + 1,
          schemaVersion: GRAPH_SCHEMA_VERSION,
          tabId: FIXED_IDS.CLIENT_A,
        },
      },
    },
    {
      name: 'unknown-error-code',
      schema: 'server-message',
      expectedPath: 'data.code',
      candidate: {
        event: SERVER_EVENT_NAMES.ERROR,
        data: { code: `${ERROR_CODES.DOCUMENT_INVALID}_UNKNOWN`, message: '', retryable: false },
      },
    },
  ];
}
