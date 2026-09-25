import { describe, expect, it } from 'vitest';

import * as limits from './index.js';

describe('central product limits', () => {
  it('keeps Phase 4 admission, timing, and rate budgets in one shared source', () => {
    expect({
      connections: limits.MAX_BOARD_CONNECTIONS,
      rooms: limits.MAX_ACTIVE_ROOMS,
      updateRate: limits.CONTENT_UPDATES_PER_SECOND,
      updateBurst: limits.CONTENT_UPDATE_BURST,
      presenceRate: limits.PRESENCE_UPDATES_PER_SECOND,
      workers: limits.MAX_VALIDATION_WORKERS,
      validationMs: limits.VALIDATION_TIMEOUT_MS,
      helloMs: limits.HELLO_TIMEOUT_MS,
      pingMs: limits.WS_PING_INTERVAL_MS,
      pongMs: limits.WS_PONG_TIMEOUT_MS,
      presenceMs: limits.PRESENCE_EXPIRY_MS,
      compactionUpdates: limits.SNAPSHOT_COMPACTION_UPDATES,
      compactionMs: limits.SNAPSHOT_COMPACTION_INTERVAL_MS,
      idleMs: limits.ROOM_IDLE_EVICTION_MS,
      retryStartMs: limits.RECONNECT_INITIAL_DELAY_MS,
      retryMaxMs: limits.RECONNECT_MAX_DELAY_MS,
    }).toEqual({
      connections: 10,
      rooms: 20,
      updateRate: 20,
      updateBurst: 40,
      presenceRate: 15,
      workers: 2,
      validationMs: 2_000,
      helloMs: 5_000,
      pingMs: 15_000,
      pongMs: 45_000,
      presenceMs: 30_000,
      compactionUpdates: 200,
      compactionMs: 60_000,
      idleMs: 300_000,
      retryStartMs: 1_000,
      retryMaxMs: 30_000,
    });
  });
  it('matches the Phase 1 graph, content, byte, and presence budgets', () => {
    expect(limits).toMatchObject({
      KIBIBYTE: 1_024,
      MEBIBYTE: 1_048_576,
      MAX_NODE_TITLE_CHARACTERS: 120,
      MAX_COMPONENT_DESCRIPTION_CHARACTERS: 2_000,
      MAX_TECHNOLOGY_CHARACTERS: 80,
      MAX_CONTENT_BODY_CHARACTERS: 20_000,
      MAX_EXTERNAL_URL_CHARACTERS: 2_048,
      MAX_EDGE_LABEL_CHARACTERS: 160,
      MAX_EDGE_PROTOCOL_CHARACTERS: 40,
      MAX_BOUNDARY_TITLE_CHARACTERS: 120,
      MAX_STEP_TITLE_CHARACTERS: 120,
      MAX_STEP_NOTES_CHARACTERS: 4_000,
      MIN_STEP_ORDER: -1_000_000,
      MAX_STEP_ORDER: 1_000_000,
      MAX_STEP_REFERENCES: 500,
      MAX_GRAPH_COORDINATE: 100_000,
      MIN_NODE_WIDTH: 160,
      MAX_NODE_WIDTH: 1_600,
      MIN_NODE_HEIGHT: 100,
      MAX_NODE_HEIGHT: 1_200,
      MAX_RECT_DIMENSION: 20_000,
      MAX_LIVE_NODES: 500,
      MAX_LIVE_EDGES: 1_000,
      MAX_LIVE_BOUNDARIES: 50,
      MAX_LIVE_PRESENTATION_STEPS: 50,
      MAX_ENCODED_YJS_STATE_BYTES: 10_485_760,
      MAX_CLIENT_UPDATE_BYTES: 1_048_576,
      MAX_WS_FRAME_BYTES: 16_777_216,
      MAX_PRESENCE_SELECTED_IDS: 100,
      MAX_DRAG_PREVIEW_POSITIONS: 100,
    });
  });
});
