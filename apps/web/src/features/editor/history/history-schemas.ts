import {
  GRAPH_SCHEMA_VERSION,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  boundarySchema,
  graphEdgeSchema,
  graphNodeSchema,
} from '@archboard/contracts';
import { z } from 'zod';

import { SELECTION_CLIPBOARD_FORMAT, SELECTION_CLIPBOARD_VERSION } from './history-constants';

export const selectionClipboardSchema = z.strictObject({
  format: z.literal(SELECTION_CLIPBOARD_FORMAT),
  version: z.literal(SELECTION_CLIPBOARD_VERSION),
  graphSchemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
  nodes: z.array(graphNodeSchema).max(MAX_LIVE_NODES),
  edges: z.array(graphEdgeSchema).max(MAX_LIVE_EDGES),
  boundaries: z.array(boundarySchema).max(MAX_LIVE_BOUNDARIES),
});
