import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  importBoardSchema,
  MAX_AI_CONTEXT_COMPONENTS,
  MAX_AI_CONTEXT_FILE_BYTES,
  PROJECT_CONTEXT_FOCUSES,
  type ProjectContextV1,
} from '@archboard/contracts';
import {
  createGraphDocument,
  createGraphObjects,
  projectGraphDocument,
} from '@archboard/document-model';
import ELK from 'elkjs/lib/elk.bundled.js';
import { createLimitGraphFixture } from '@archboard/fixtures';
import {
  parseProjectContext,
  prepareProjectContext,
} from '@/features/editor/project-context/project-context-draft';
import {
  fallbackProjectLayout,
  type ProjectLayoutInput,
} from '@/features/editor/project-context/project-context-layout';
import { runProjectLayeredLayout } from '@/platform/layout/project-layout-worker';
import { preflightGraphAdditions } from '@/features/editor/project-context/project-context-preflight';
import { projectContextEnvelope } from '@/features/editor/project-context/project-context-import';
import { createLocalContextPrompt } from '@/features/editor/project-context/local-context-prompt';
import { projectContextFilename } from '@/features/editor/project-context/project-context-focus';

const UUID_DIGITS = 12;
const ENTITY_COUNT = 6;
const CAPACITY_TEST_TIMEOUT_MS = 10_000;
const GRID_ORIGIN = { x: 2000, y: -1000 };
const allocate = () => {
  let next = 1;
  return () => `00000000-0000-4000-8000-${(next++).toString().padStart(UUID_DIGITS, '0')}`;
};
const context = (): ProjectContextV1 => ({
  kind: 'archboard.project-context',
  schemaVersion: 1,
  diagramFocus: 'api',
  project: {
    name: 'Example',
    description: 'Supplied architecture only',
    technologies: ['React', 'Node', 'PostgreSQL'],
  },
  components: [
    {
      key: 'web',
      name: 'Web application',
      category: 'client',
      technology: 'React',
      description: 'Shows supplied data',
      evidenceKeys: [],
    },
    {
      key: 'api',
      name: 'API',
      category: 'service',
      technology: 'Node',
      description: 'Handles requests',
      evidenceKeys: [],
    },
    {
      key: 'data',
      name: 'Database',
      category: 'database',
      technology: 'PostgreSQL',
      description: 'Stores data',
      evidenceKeys: [],
    },
  ],
  connections: [
    { source: 'web', target: 'api', label: 'Requests', protocol: 'HTTPS', evidenceKeys: [] },
    { source: 'api', target: 'data', label: 'Reads and writes', protocol: 'SQL', evidenceKeys: [] },
  ],
  groups: [{ key: 'application', title: 'Application', componentKeys: ['web', 'api'] }],
  evidence: [],
  constraints: ['One deployment'],
  unknowns: ['Hosting is unspecified'],
});
const grid = async (input: ProjectLayoutInput) => ({
  status: 'fallback' as const,
  reason: 'unavailable' as const,
  positions: fallbackProjectLayout(input),
});
afterEach(() => vi.unstubAllGlobals());

describe('direct project context import', () => {
  it('maps every supplied component, connection and group without network access or source execution', async () => {
    const fetch = vi.fn(() => {
      throw new Error('Network access forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    const value = context();
    const before = JSON.stringify(value);
    const layout = vi.fn(grid);
    const draft = await prepareProjectContext(value, new AbortController().signal, {
      layout,
      allocate: allocate(),
      origin: GRID_ORIGIN,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).toBe(before);
    expect(draft.context).toEqual(value);
    expect(draft.graph.nodes).toHaveLength(value.components.length);
    expect(draft.graph.edges).toHaveLength(value.connections.length);
    expect(draft.graph.boundaries).toHaveLength(value.groups.length);
    expect(draft.graph.steps).toEqual([]);
    expect(
      new Set(
        [...draft.graph.nodes, ...draft.graph.edges, ...draft.graph.boundaries].map(({ id }) => id),
      ).size,
    ).toBe(ENTITY_COUNT);
    const nodes = new Map(draft.graph.nodes.map((node) => [node.title, node]));
    for (const component of value.components)
      expect(nodes.get(component.name)?.content).toMatchObject({
        description: component.description,
        technology: component.technology,
        category: component.category,
      });
    expect(draft.graph.edges[0]).toMatchObject({
      sourceId: nodes.get('Web application')!.id,
      targetId: nodes.get('API')!.id,
      label: 'Requests',
      protocol: 'HTTPS',
      direction: 'forward',
    });
    const layoutJson = JSON.stringify(layout.mock.calls[0]![0]);
    for (const privateText of [
      value.project.description,
      value.components[0]!.description,
      value.unknowns[0]!,
    ])
      expect(layoutJson).not.toContain(privateText);
    for (const node of draft.graph.nodes) {
      expect(node.position.x).toBeGreaterThanOrEqual(GRID_ORIGIN.x);
      expect(node.position.y).toBeGreaterThanOrEqual(GRID_ORIGIN.y);
    }
  });
  it('supports the full 100-component context contract rather than the retired 40-node model limit', async () => {
    const value = context();
    value.components = Array.from({ length: MAX_AI_CONTEXT_COMPONENTS }, (_, index) => ({
      ...value.components[0]!,
      key: `component-${index}`,
      name: `Component ${index}`,
    }));
    value.connections = [];
    value.groups = [];
    const draft = await prepareProjectContext(value, new AbortController().signal, {
      layout: grid,
      allocate: allocate(),
    });
    expect(draft.graph.nodes).toHaveLength(MAX_AI_CONTEXT_COMPONENTS);
    const document = createGraphDocument();
    const bytes = Y.encodeStateAsUpdate(document);
    expect(preflightGraphAdditions(bytes, draft.graph).updateBytes).toBeGreaterThan(0);
    expect(Y.encodeStateAsUpdate(document)).toEqual(bytes);
    document.destroy();
  });
  it('keeps all content with the installed ELK engine and tolerates cross-kind logical key collisions', async () => {
    const value = context();
    value.components[0]!.key = 'context-flow-0';
    value.connections[0]!.source = 'context-flow-0';
    value.groups[0]!.key = 'api';
    value.groups[0]!.componentKeys[0] = 'context-flow-0';
    const draft = await prepareProjectContext(value, new AbortController().signal, {
      allocate: allocate(),
      layout: async (input) => ({
        status: 'layered',
        positions: await runProjectLayeredLayout(input, new ELK()),
      }),
    });
    expect(draft.graph.nodes).toHaveLength(value.components.length);
    expect(draft.graph.edges).toHaveLength(value.connections.length);
    expect(draft.layout.status).toBe('layered');
  });
  it('rejects unsupported self relationships before layout instead of silently dropping them', async () => {
    const value = context();
    value.connections = [{ ...value.connections[0]!, source: 'data', target: 'data' }];
    const layout = vi.fn(grid);
    await expect(
      prepareProjectContext(value, new AbortController().signal, { layout }),
    ).rejects.toThrow('Reference must resolve');
    expect(layout).not.toHaveBeenCalled();
  });
  it('fails before applying when byte budgets or existing object identities conflict', async () => {
    const draft = await prepareProjectContext(context(), new AbortController().signal, {
      layout: grid,
      allocate: allocate(),
    });
    const document = createGraphDocument();
    createGraphObjects(document, draft.graph);
    const before = Y.encodeStateAsUpdate(document);
    expect(() => preflightGraphAdditions(before, draft.graph)).toThrow();
    expect(() => preflightGraphAdditions(before, draft.graph, { stateBytes: 1 })).toThrow(
      'byte budget',
    );
    expect(Y.encodeStateAsUpdate(document)).toEqual(before);
    expect(projectGraphDocument(document).nodes).toHaveLength(draft.graph.nodes.length);
    document.destroy();
  });
  it(
    'checks remaining board capacity against the full current document',
    async () => {
      const draft = await prepareProjectContext(context(), new AbortController().signal, {
        layout: grid,
        allocate: allocate(),
      });
      const document = createGraphDocument();
      createGraphObjects(document, createLimitGraphFixture());
      const before = Y.encodeStateAsUpdate(document);
      expect(() => preflightGraphAdditions(before, draft.graph)).toThrow('live entity limit');
      expect(Y.encodeStateAsUpdate(document)).toEqual(before);
      document.destroy();
    },
    CAPACITY_TEST_TIMEOUT_MS,
  );
  it('does not return a late preview after cancellation during layout', async () => {
    const controller = new AbortController();
    const layout = async (input: ProjectLayoutInput) => {
      controller.abort();
      return grid(input);
    };
    await expect(prepareProjectContext(context(), controller.signal, { layout })).rejects.toThrow(
      'cancelled',
    );
  });
  it('rejects oversized, invalid and empty files and stops cancelled preparations', async () => {
    expect(() => parseProjectContext(new Uint8Array(MAX_AI_CONTEXT_FILE_BYTES + 1))).toThrow();
    expect(() => parseProjectContext(new TextEncoder().encode('{'))).toThrow();
    const invalid = context();
    invalid.connections[0]!.target = 'missing';
    await expect(
      prepareProjectContext(invalid, new AbortController().signal, { layout: grid }),
    ).rejects.toThrow();
    await expect(
      prepareProjectContext(
        { ...context(), components: [], connections: [], groups: [] },
        new AbortController().signal,
        { layout: grid },
      ),
    ).rejects.toThrow('no components');
    const cancelled = new AbortController();
    cancelled.abort();
    const layout = vi.fn(grid);
    await expect(prepareProjectContext(context(), cancelled.signal, { layout })).rejects.toThrow(
      'cancelled',
    );
    expect(layout).not.toHaveBeenCalled();
    await expect(
      prepareProjectContext(context(), new AbortController().signal, {
        layout: grid,
        allocate: () => allocate()(),
      }),
    ).rejects.toThrow('duplicate ID');
  });
  it('reuses normal private-board import without claiming a committed server save', async () => {
    const draft = await prepareProjectContext(context(), new AbortController().signal, {
      layout: grid,
      allocate: allocate(),
    });
    const file = projectContextEnvelope(draft, '2026-10-14T12:00:00.000Z');
    expect(importBoardSchema.parse({ title: 'New board', file }).file.graph).toEqual(draft.graph);
    expect(file.syncStatusAtExport).toBe('local-only');
  });
  it.each(Object.values(PROJECT_CONTEXT_FOCUSES))(
    'keeps a valid focused extraction prompt for %s with local import instructions',
    (focus) => {
      const prompt = createLocalContextPrompt(focus, 'Trace order processing.');
      const example = parseProjectContext(
        new TextEncoder().encode(
          prompt.slice(prompt.indexOf('\n{'), prompt.indexOf('\nRules:')).trim(),
        ),
      );
      expect(example.diagramFocus).toBe(focus);
      expect(prompt).toContain('without another AI call');
      expect(prompt).not.toContain('cloud AI service');
      expect(prompt).toContain('Do not read or include secrets');
    },
  );
  it('provides separate valid entity and storage examples with distinct output files', async () => {
    const examples = (['database', 'storage'] as const).map((focus) => {
      const prompt = createLocalContextPrompt(focus);
      expect(prompt).toContain(projectContextFilename(focus));
      return parseProjectContext(
        new TextEncoder().encode(
          prompt.slice(prompt.indexOf('\n{'), prompt.indexOf('\nRules:')).trim(),
        ),
      );
    });
    expect(projectContextFilename('database')).not.toBe(projectContextFilename('storage'));
    expect(examples[0]!.components.every((component) => component.category === 'generic')).toBe(
      true,
    );
    expect(examples[1]!.components.map((component) => component.category)).toEqual([
      'service',
      'database',
    ]);
    for (const example of examples) {
      const draft = await prepareProjectContext(example, new AbortController().signal, {
        layout: grid,
        allocate: allocate(),
      });
      expect(draft.graph.edges[0]?.protocol).toBe(example.connections[0]!.protocol);
      expect(
        importBoardSchema.parse({
          title: 'Focused board',
          file: projectContextEnvelope(draft, '2026-10-14T12:00:00.000Z'),
        }).file.graph.nodes,
      ).toHaveLength(example.components.length);
    }
  });
});
