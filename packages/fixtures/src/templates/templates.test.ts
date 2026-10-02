import { describe, expect, it } from 'vitest';
import { portableGraphProjectionSchema } from '@archboard/contracts';
import { resolveTemplate, TEMPLATE_CHOICES } from './index.js';

const THIRD_STEP = 2;
const FOURTH_STEP = 3;
const THREE_STEP_ORDER = [0, 1, THIRD_STEP];
const FOUR_STEP_ORDER = [...THREE_STEP_ORDER, FOURTH_STEP];
const SERVICE_BOUNDARY_COUNT = 2;

describe('bundled architecture examples', () => {
  it.each(TEMPLATE_CHOICES)(
    'strictly validates $id with complete walkthrough and technical content',
    ({ id }) => {
      const graph = resolveTemplate(id);
      expect(portableGraphProjectionSchema.parse(graph)).toEqual(graph);
      expect(graph.steps.map((s) => s.order)).toEqual(
        id === 'web-application' ? FOUR_STEP_ORDER : THREE_STEP_ORDER,
      );
      const required =
        id === 'web-application'
          ? ['Browser', 'API service', 'Database', 'Cache', 'Request payload']
          : id === 'event-processing'
            ? [
                'Producer service',
                'Queue',
                'Worker',
                'Database',
                'External notification service',
                'Retry behavior',
              ]
            : [
                'API gateway',
                'Identity service',
                'Application service',
                'Database',
                'Application schema',
                'Data ownership',
              ];
      expect(graph.nodes.map((n) => n.title)).toEqual(required);
      expect(graph.boundaries).toHaveLength(
        id === 'web-application' ? 1 : id === 'event-processing' ? 0 : SERVICE_BOUNDARY_COUNT,
      );
      expect(graph.edges.every((e) => e.label && e.protocol)).toBe(true);
      for (const step of graph.steps)
        for (const node of graph.nodes.filter((n) => step.nodeIds.includes(n.id))) {
          expect(node.position.x).toBeGreaterThanOrEqual(step.rect.x);
          expect(node.position.y).toBeGreaterThanOrEqual(step.rect.y);
          expect(node.position.x + node.size.width).toBeLessThanOrEqual(
            step.rect.x + step.rect.width,
          );
          expect(node.position.y + node.size.height).toBeLessThanOrEqual(
            step.rect.y + step.rect.height,
          );
        }
      graph.nodes[0]!.title = 'changed copy';
      expect(resolveTemplate(id).nodes[0]!.title).toEqual(required[0]);
    },
  );
  it.each(['../../module', '__proto__', 'constructor', 'custom'])(
    'rejects unknown registry key %s',
    (id) => {
      expect(() => resolveTemplate(id as 'web-application')).toThrow();
    },
  );
});
