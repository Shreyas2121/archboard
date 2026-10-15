import { describe, expect, it } from 'vitest';

import {
  AI_SCHEMA_VERSION,
  AI_DIAGRAM_FOCUSES,
  MAX_AI_CONTEXT_FILE_BYTES,
  MAX_AI_CONTEXT_COMPONENTS,
  MAX_AI_EVENT_DELTA_CHARACTERS,
  MAX_AI_EVIDENCE_EXCERPT_CHARACTERS,
  MAX_AI_EVIDENCE_TOTAL_CHARACTERS,
  MAX_AI_HISTORY_MESSAGES,
  MAX_AI_OUTPUT_NODES,
  MAX_AI_PROMPT_CHARACTERS,
  MAX_AI_REQUEST_BYTES,
  MAX_AI_RESULT_BYTES,
  MAX_CONTENT_BODY_CHARACTERS,
  aiAvailabilitySchema,
  aiBoardContextSchema,
  aiCreateRunSchema,
  aiDiagramProposalSchema,
  aiEvidencePathSchema,
  aiJsonBytes,
  aiOperationSchema,
  aiResultForRequestSchema,
  aiResultSchema,
  aiRunEventSchema,
  aiRunSchema,
  aiSemanticKeySchema,
  aiTokenPreflightSchema,
  aiUnsignedDecimalSchema,
  applicationIdSchema,
  parseProjectContextFile,
  projectContextV1Schema,
} from '../index.js';

const ID = '00000000-0000-4000-8000-000000000001';
const EDGE_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_ID = '00000000-0000-4000-8000-000000000003';
const TIME = '2026-10-03T00:00:00Z';
const EXPIRY = '2026-10-03T00:15:00Z';
const ESCAPED_CONSTRAINT_CHARACTERS = 1_500;
const UUID_SUFFIX_LENGTH = 12;
const component = {
  key: 'web',
  name: 'Web',
  category: 'client',
  technology: 'React',
  description: 'Browser',
};
const contextInput = {
  kind: 'archboard.project-context',
  schemaVersion: AI_SCHEMA_VERSION,
  project: { name: 'Example', description: 'A private application' },
};
const semanticNode = {
  key: 'web',
  kind: 'component',
  title: 'Web',
  color: 'blue',
  content: { category: 'client', technology: 'React', description: 'Browser', externalUrl: null },
};
const commentary = {
  explanation: 'Supplied architecture',
  claims: [],
  assumptions: [],
  questions: [],
};
const diagram = {
  kind: 'diagram',
  schemaVersion: AI_SCHEMA_VERSION,
  nodes: [semanticNode],
  edges: [],
  boundaries: [],
  steps: [],
  ...commentary,
};
const boardContext = {
  graph: {
    schemaVersion: 1,
    nodes: [
      {
        kind: semanticNode.kind,
        title: semanticNode.title,
        color: semanticNode.color,
        content: semanticNode.content,
        id: ID,
        position: { x: 0, y: 0 },
        size: { width: 320, height: 180 },
      },
    ],
    edges: [],
    boundaries: [],
    steps: [],
  },
  nodeBindings: [{ key: 'web', nodeId: ID }],
  confirmedServerSequence: null,
};
const requestInput = {
  schemaVersion: AI_SCHEMA_VERSION,
  task: 'diagram-described',
  target: { kind: 'new-board' },
  prompt: 'Draw the supplied application.',
};
const scopedRequest = (task: string) =>
  aiCreateRunSchema.parse({
    ...requestInput,
    task,
    target: { kind: 'board', boardId: ID },
    boardContext,
  });
const readyRun = {
  schemaVersion: AI_SCHEMA_VERSION,
  id: ID,
  task: 'diagram-described',
  state: 'ready-for-review',
  createdAt: TIME,
  updatedAt: TIME,
  content: { status: 'available', expiresAt: EXPIRY, result: diagram },
  failure: null,
  source: 'generation',
};

describe('project context and byte budgets', () => {
  it('accepts optional bounded diagram focus metadata without changing legacy files', () => {
    expect(projectContextV1Schema.parse(contextInput)).not.toHaveProperty('diagramFocus');
    for (const diagramFocus of Object.values(AI_DIAGRAM_FOCUSES)) {
      const parsed = parseProjectContextFile(JSON.stringify({ ...contextInput, diagramFocus }));
      expect(parsed.diagramFocus).toBe(diagramFocus);
      const request = aiCreateRunSchema.parse({ ...requestInput, context: parsed });
      expect(request.context?.diagramFocus).toBe(diagramFocus);
    }
    for (const diagramFocus of ['custom', '', null, { type: 'api' }])
      expect(projectContextV1Schema.safeParse({ ...contextInput, diagramFocus }).success).toBe(
        false,
      );
  });
  it('normalizes omitted collections and preserves exact text and array order', () => {
    const parsed = projectContextV1Schema.parse(contextInput);
    expect(parsed.components).toEqual([]);
    expect(parsed.evidence).toEqual([]);
    expect(parsed.project.technologies).toEqual([]);
    const prompt = '  Draw Web before API.\n';
    expect(aiCreateRunSchema.parse({ ...requestInput, prompt }).prompt).toBe(prompt);
    expect(
      projectContextV1Schema.parse({ ...contextInput, constraints: ['Second', 'First'] })
        .constraints,
    ).toEqual(['Second', 'First']);
  });
  it.each([
    { ...contextInput, schemaVersion: 2 },
    { ...contextInput, credentials: 'private' },
    { ...contextInput, project: { ...contextInput.project, endpoint: 'https://example.com' } },
    { ...contextInput, components: null },
    { ...contextInput, components: [{ ...component, metadata: {} }] },
  ])('rejects unknown properties, versions and malformed collections: %j', (input) => {
    expect(projectContextV1Schema.safeParse(input).success).toBe(false);
  });
  it('rejects duplicate components and unresolved connections/groups/evidence', () => {
    for (const input of [
      { components: [component, component] },
      {
        components: [component],
        connections: [{ source: 'web', target: 'missing', label: '', protocol: '' }],
      },
      {
        components: [component],
        groups: [{ key: 'group', title: '', componentKeys: ['missing'] }],
      },
      { components: [{ ...component, evidenceKeys: ['missing'] }] },
    ])
      expect(projectContextV1Schema.safeParse({ ...contextInput, ...input }).success).toBe(false);
    const result = projectContextV1Schema.safeParse({
      ...contextInput,
      components: [component, component],
    });
    if (!result.success)
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'components.1.key')).toBe(
        true,
      );
  });
  it.each([
    '/etc/config',
    '../private',
    'src/../private',
    'C:/private',
    '\\\\host\\share',
    'src\\file.ts',
    'https://example.com/code',
    './file',
    'src//file',
    'src/file?secret',
    'src/\u0000file',
  ])('rejects unsafe evidence path %j', (path) => {
    expect(aiEvidencePathSchema.safeParse(path).success).toBe(false);
  });
  it('accepts bounded evidence with honest line ranges and resolves evidence keys', () => {
    const evidence = {
      key: 'entry',
      path: 'src/main.ts',
      startLine: 1,
      endLine: 1,
      excerpt: 'bootstrap()',
    };
    expect(
      projectContextV1Schema.parse({
        ...contextInput,
        components: [{ ...component, evidenceKeys: ['entry'] }],
        evidence: [evidence],
      }).evidence,
    ).toEqual([evidence]);
    expect(
      projectContextV1Schema.safeParse({
        ...contextInput,
        evidence: [{ ...evidence, startLine: 2 }],
      }).success,
    ).toBe(false);
    expect(
      projectContextV1Schema.safeParse({ ...contextInput, evidence: [evidence, evidence] }).success,
    ).toBe(false);
  });
  it('enforces aggregate excerpts independently from each excerpt limit', () => {
    const entries =
      Math.floor(MAX_AI_EVIDENCE_TOTAL_CHARACTERS / MAX_AI_EVIDENCE_EXCERPT_CHARACTERS) + 1;
    const evidence = Array.from({ length: entries }, (_, index) => ({
      key: `entry_${index}`,
      path: 'src/file.ts',
      startLine: 1,
      endLine: 1,
      excerpt: 'x'.repeat(MAX_AI_EVIDENCE_EXCERPT_CHARACTERS),
    }));
    expect(projectContextV1Schema.safeParse({ ...contextInput, evidence }).success).toBe(false);
  });
  it('counts raw UTF-8 file bytes, including whitespace, before parsing', () => {
    const text = JSON.stringify(contextInput);
    expect(parseProjectContextFile(text)).toEqual(projectContextV1Schema.parse(contextInput));
    expect(() => parseProjectContextFile(text + ' '.repeat(MAX_AI_CONTEXT_FILE_BYTES))).toThrow();
    expect(() => parseProjectContextFile('{broken')).toThrow();
    expect(aiJsonBytes('😀')).toBe(new TextEncoder().encode(JSON.stringify('😀')).byteLength);
  });
  it('does not confuse context file limits with escaping in the HTTP body', () => {
    const value = {
      ...contextInput,
      constraints: Array.from({ length: 100 }, () =>
        '\u0000'.repeat(ESCAPED_CONSTRAINT_CHARACTERS),
      ),
    };
    expect(projectContextV1Schema.safeParse(value).success).toBe(true);
    const wrapperBytes = aiJsonBytes({ file: JSON.stringify(value) });
    expect(wrapperBytes).toBeGreaterThan(MAX_AI_CONTEXT_FILE_BYTES);
    expect(MAX_AI_REQUEST_BYTES).toBeGreaterThan(wrapperBytes);
  });
});

describe('public requests and preflight', () => {
  it.each([
    'provider',
    'model',
    'apiKey',
    'endpoint',
    'cost',
    'maximumOutputTokens',
    'system',
    'tools',
  ])('rejects client authority field %s', (field) => {
    expect(aiCreateRunSchema.safeParse({ ...requestInput, [field]: 'untrusted' }).success).toBe(
      false,
    );
  });
  it('bounds prompts and history, and requires explicit board context for followups', () => {
    expect(aiCreateRunSchema.safeParse({ ...requestInput, prompt: ' ' }).success).toBe(false);
    expect(
      aiCreateRunSchema.safeParse({
        ...requestInput,
        prompt: 'x'.repeat(MAX_AI_PROMPT_CHARACTERS + 1),
      }).success,
    ).toBe(false);
    expect(
      aiCreateRunSchema.safeParse({
        ...requestInput,
        history: Array.from({ length: MAX_AI_HISTORY_MESSAGES + 1 }, () => ({
          role: 'user',
          text: 'x',
        })),
      }).success,
    ).toBe(false);
    expect(
      aiCreateRunSchema.safeParse({ ...requestInput, history: [{ role: 'system', text: 'do it' }] })
        .success,
    ).toBe(false);
    expect(
      aiCreateRunSchema.safeParse({ ...requestInput, task: 'explain-selection' }).success,
    ).toBe(false);
    expect(aiCreateRunSchema.safeParse({ ...requestInput, boardContext }).success).toBe(false);
    expect(scopedRequest('explain-selection').boardContext?.graph.nodes[0]?.id).toBe(ID);
  });
  it('requires unique complete bindings for selected graph nodes', () => {
    expect(aiBoardContextSchema.safeParse({ ...boardContext, nodeBindings: [] }).success).toBe(
      false,
    );
    expect(
      aiBoardContextSchema.safeParse({
        ...boardContext,
        nodeBindings: [{ key: 'web', nodeId: OTHER_ID }],
      }).success,
    ).toBe(false);
    expect(
      aiBoardContextSchema.safeParse({
        ...boardContext,
        nodeBindings: [...boardContext.nodeBindings, ...boardContext.nodeBindings],
      }).success,
    ).toBe(false);
  });
  it('rejects an encoded request above the body cap despite valid field sizes', () => {
    const graphNodes = Array.from({ length: MAX_AI_CONTEXT_COMPONENTS }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(UUID_SUFFIX_LENGTH, '0')}`,
      kind: 'note',
      title: '',
      color: 'gray',
      position: { x: 0, y: 0 },
      size: { width: 320, height: 180 },
      content: { body: '\u0000'.repeat(MAX_CONTENT_BODY_CHARACTERS) },
    }));
    const selected = {
      ...boardContext,
      graph: { ...boardContext.graph, nodes: graphNodes },
      nodeBindings: graphNodes.map((node, index) => ({ key: `node_${index}`, nodeId: node.id })),
    };
    const input = {
      ...requestInput,
      target: { kind: 'board', boardId: ID },
      boardContext: selected,
    };
    expect(aiBoardContextSchema.safeParse(selected).success).toBe(true);
    expect(aiJsonBytes(input)).toBeGreaterThan(MAX_AI_REQUEST_BYTES);
    expect(aiCreateRunSchema.safeParse(input).success).toBe(false);
  });
  it('uses server counting facts with instruction/schema overhead and reserved output', () => {
    const facts = {
      inputTokensUpperBound: 100,
      maximumInputTokens: 200,
      maximumOutputTokens: 50,
      contextWindowTokens: 150,
      countingVersion: 'fixture-v1',
    };
    expect(aiTokenPreflightSchema.safeParse(facts).success).toBe(true);
    expect(aiTokenPreflightSchema.safeParse({ ...facts, inputTokensUpperBound: 101 }).success).toBe(
      false,
    );
    expect(aiTokenPreflightSchema.safeParse({ ...facts, maximumInputTokens: 99 }).success).toBe(
      false,
    );
    expect(aiTokenPreflightSchema.safeParse({ ...facts, inputTokensUpperBound: 1.5 }).success).toBe(
      false,
    );
  });
  it('keeps logical keys disjoint from graph UUIDs', () => {
    expect(applicationIdSchema.safeParse('web').success).toBe(false);
    expect(aiSemanticKeySchema.safeParse(ID).success).toBe(false);
    expect(aiSemanticKeySchema.safeParse('abcdef12-0000-4000-8000-000000000001').success).toBe(
      false,
    );
    expect(aiSemanticKeySchema.safeParse('Web_API-1').success).toBe(true);
  });
});

describe('bounded semantic proposals and reviewed references', () => {
  it('accepts editable typed content while rejecting geometry, IDs, and unsafe URLs', () => {
    expect(aiResultSchema.safeParse(diagram).success).toBe(true);
    for (const extra of [
      { id: ID },
      { position: { x: 0, y: 0 } },
      { content: { ...semanticNode.content, externalUrl: 'javascript:alert(1)' } },
    ])
      expect(
        aiDiagramProposalSchema.safeParse({ ...diagram, nodes: [{ ...semanticNode, ...extra }] })
          .success,
      ).toBe(false);
  });
  it('rejects broken, duplicate, self-loop, and wrong-kind semantic references', () => {
    const edge = {
      key: 'request',
      source: 'web',
      target: 'api',
      label: 'HTTPS',
      protocol: '',
      direction: 'forward',
      style: 'solid',
    };
    for (const variant of [
      { nodes: [semanticNode, semanticNode] },
      { edges: [edge] },
      { edges: [{ ...edge, target: 'web' }] },
      { boundaries: [{ key: 'web', title: '', nodeKeys: ['web'] }] },
      { steps: [{ key: 'step', title: '', notes: '', nodeKeys: [], edgeKeys: ['web'] }] },
    ])
      expect(aiDiagramProposalSchema.safeParse({ ...diagram, ...variant }).success).toBe(false);
  });
  it('enforces output object counts and aggregate serialized result capacity', () => {
    expect(
      aiResultSchema.safeParse({
        ...diagram,
        nodes: Array.from({ length: MAX_AI_OUTPUT_NODES + 1 }, (_, index) => ({
          ...semanticNode,
          key: `node_${index}`,
        })),
      }).success,
    ).toBe(false);
    const large = {
      ...diagram,
      nodes: Array.from({ length: MAX_AI_OUTPUT_NODES }, (_, index) => ({
        key: `node_${index}`,
        kind: 'note',
        title: '',
        color: 'gray',
        content: { body: 'x'.repeat(MAX_CONTENT_BODY_CHARACTERS) },
      })),
    };
    expect(aiJsonBytes(large)).toBeGreaterThan(MAX_AI_RESULT_BYTES);
    expect(aiResultSchema.safeParse(large).success).toBe(false);
  });
  it('requires at most three focused questions, and evidence for evidenced claims', () => {
    expect(
      aiResultSchema.safeParse({
        kind: 'clarification',
        schemaVersion: 1,
        explanation: '',
        questions: ['One?'],
      }).success,
    ).toBe(true);
    expect(
      aiResultSchema.safeParse({
        kind: 'clarification',
        schemaVersion: 1,
        explanation: '',
        questions: [],
      }).success,
    ).toBe(false);
    expect(aiResultSchema.safeParse({ ...diagram, questions: ['1', '2', '3', '4'] }).success).toBe(
      false,
    );
    expect(
      aiResultSchema.safeParse({
        ...diagram,
        claims: [{ text: 'Observed', provenance: 'evidenced', evidenceKeys: [] }],
      }).success,
    ).toBe(false);
    const request = aiCreateRunSchema.parse(requestInput);
    expect(
      aiResultForRequestSchema(request).safeParse({
        ...diagram,
        claims: [{ text: 'Observed', provenance: 'evidenced', evidenceKeys: ['invented'] }],
      }).success,
    ).toBe(false);
  });
  it('rejects task substitution and highlights outside the reviewed selection', () => {
    const request = scopedRequest('explain-selection');
    const guidance = {
      kind: 'guidance',
      schemaVersion: 1,
      ...commentary,
      highlightNodeIds: [ID],
      highlightEdgeIds: [],
    };
    expect(aiResultForRequestSchema(request).safeParse(guidance).success).toBe(true);
    expect(aiResultForRequestSchema(request).safeParse(diagram).success).toBe(false);
    expect(
      aiResultForRequestSchema(request).safeParse({ ...guidance, highlightEdgeIds: [ID] }).success,
    ).toBe(false);
    expect(
      aiResultForRequestSchema(request).safeParse({ ...guidance, highlightNodeIds: [OTHER_ID] })
        .success,
    ).toBe(false);
  });
  it('requires field preconditions and rejects arbitrary edits and immutable endpoint/kind changes', () => {
    const rename = { type: 'rename-node', nodeId: ID, expectedTitle: 'Web', title: 'Client' };
    expect(aiOperationSchema.safeParse(rename).success).toBe(true);
    for (const operation of [
      { type: 'delete-node', nodeId: ID },
      { type: 'replace-document', graph: {} },
      { ...rename, expectedTitle: undefined },
      { ...rename, patch: { kind: 'note' } },
      {
        type: 'label-edge',
        edgeId: EDGE_ID,
        label: '',
        protocol: '',
        expectedLabel: '',
        expectedProtocol: '',
        targetId: OTHER_ID,
      },
    ])
      expect(aiOperationSchema.safeParse(operation).success).toBe(false);
    const edits = { kind: 'edits', schemaVersion: 1, ...commentary, operations: [rename] };
    expect(aiResultForRequestSchema(scopedRequest('scoped-edit')).safeParse(edits).success).toBe(
      true,
    );
    expect(
      aiResultForRequestSchema(scopedRequest('scoped-edit')).safeParse({
        ...edits,
        operations: [{ ...rename, expectedTitle: 'Invented prior title' }],
      }).success,
    ).toBe(false);
    expect(
      aiResultForRequestSchema(scopedRequest('scoped-edit')).safeParse({
        ...edits,
        operations: [{ ...rename, nodeId: OTHER_ID }],
      }).success,
    ).toBe(false);
    expect(
      aiResultForRequestSchema(scopedRequest('scoped-edit')).safeParse({
        ...edits,
        operations: [{ type: 'set-note-body', nodeId: ID, expectedBody: '', body: 'new' }],
      }).success,
    ).toBe(false);
  });
  it('validates additive edge references including existing logical bindings', () => {
    const addNode = { type: 'add-node', node: { ...semanticNode, key: 'api' } };
    const edge = {
      key: 'request',
      source: 'web',
      target: 'api',
      label: '',
      protocol: '',
      direction: 'forward',
      style: 'solid',
    };
    const edits = {
      kind: 'edits',
      schemaVersion: 1,
      ...commentary,
      operations: [addNode, { type: 'add-edge', edge }],
    };
    const schema = aiResultForRequestSchema(scopedRequest('scoped-edit'));
    expect(schema.safeParse(edits).success).toBe(true);
    expect(schema.safeParse({ ...edits, operations: [{ type: 'add-edge', edge }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...edits, operations: [addNode, addNode] }).success).toBe(false);
  });
  it('requires reviewed presentation references and explicit replacement intent', () => {
    const result = {
      kind: 'presentation',
      schemaVersion: 1,
      mode: 'append',
      expectedStepIds: [],
      steps: [{ key: 'overview', title: 'Overview', notes: '', nodeIds: [ID], edgeIds: [] }],
      ...commentary,
    };
    const schema = aiResultForRequestSchema(scopedRequest('presentation'));
    expect(schema.safeParse(result).success).toBe(true);
    expect(
      schema.safeParse({ ...result, steps: [{ ...result.steps[0], edgeIds: [ID] }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...result, mode: 'replace-all' }).success).toBe(false);
    expect(
      schema.safeParse({
        ...result,
        steps: [{ ...result.steps[0], rect: { x: 0, y: 0, width: 100, height: 100 } }],
      }).success,
    ).toBe(false);
  });
});

describe('privacy-safe lifecycle, allowance and events', () => {
  it('represents ready and expired content without retaining expired private output', () => {
    expect(aiRunSchema.safeParse(readyRun).success).toBe(true);
    expect(
      aiRunSchema.safeParse({ ...readyRun, content: { status: 'expired', expiredAt: EXPIRY } })
        .success,
    ).toBe(true);
    expect(
      aiRunSchema.safeParse({
        ...readyRun,
        content: { status: 'expired', expiredAt: EXPIRY, result: diagram },
      }).success,
    ).toBe(false);
    expect(
      aiRunSchema.safeParse({ ...readyRun, content: { ...readyRun.content, expiresAt: TIME } })
        .success,
    ).toBe(false);
  });
  it('rejects inconsistent run states, future versions, and leaked diagnostics', () => {
    for (const value of [
      { ...readyRun, schemaVersion: 2 },
      { ...readyRun, state: 'generating' },
      { ...readyRun, failure: { code: 'AI_REFUSED' } },
      { ...readyRun, provider: 'openai' },
      { ...readyRun, task: 'explain-selection' },
      { ...readyRun, updatedAt: '2026-10-02T00:00:00Z' },
    ])
      expect(aiRunSchema.safeParse(value).success).toBe(false);
    const unknown = {
      ...readyRun,
      state: 'outcome-unknown',
      content: { status: 'unavailable' },
      failure: { code: 'AI_OUTCOME_UNKNOWN' },
    };
    expect(aiRunSchema.safeParse(unknown).success).toBe(true);
    expect(
      aiRunSchema.safeParse({
        ...unknown,
        failure: { code: 'AI_OUTCOME_UNKNOWN', message: 'secret SDK trace' },
      }).success,
    ).toBe(false);
    expect(
      aiRunSchema.safeParse({ ...unknown, failure: { code: 'AI_GENERATION_FAILED' } }).success,
    ).toBe(false);
  });
  it('validates exact decimal-string money and honest unknown reset times', () => {
    expect(aiUnsignedDecimalSchema.safeParse('9007199254740993').success).toBe(true);
    for (const value of [0, '-1', '1.2', '01', '1e3'])
      expect(aiUnsignedDecimalSchema.safeParse(value).success).toBe(false);
    const available = {
      schemaVersion: 1,
      available: true,
      allowance: { remainingFreshRuns: 0, resetsAt: null, remainingMicroUsd: null },
    };
    expect(aiAvailabilitySchema.safeParse(available).success).toBe(true);
    expect(
      aiAvailabilitySchema.safeParse({
        ...available,
        allowance: { remainingFreshRuns: null, remainingMicroUsd: null, resetsAt: null },
      }).success,
    ).toBe(true);
    expect(
      aiAvailabilitySchema.safeParse({
        ...available,
        allowance: { ...available.allowance, remainingFreshRuns: -1 },
      }).success,
    ).toBe(false);
    expect(aiAvailabilitySchema.safeParse({ ...available, key: 'private' }).success).toBe(false);
  });
  it('bounds SSE deltas and uses result notices without provider or proposal payloads', () => {
    const event = {
      schemaVersion: 1,
      runId: ID,
      sequence: '1',
      type: 'result-available',
      state: 'ready-for-review',
      expiresAt: EXPIRY,
    };
    expect(aiRunEventSchema.safeParse(event).success).toBe(true);
    expect(aiRunEventSchema.safeParse({ ...event, result: diagram }).success).toBe(false);
    expect(aiRunEventSchema.safeParse({ ...event, providerRequestId: 'private' }).success).toBe(
      false,
    );
    expect(
      aiRunEventSchema.safeParse({
        schemaVersion: 1,
        runId: ID,
        sequence: '2',
        type: 'text-delta',
        text: 'x'.repeat(MAX_AI_EVENT_DELTA_CHARACTERS + 1),
      }).success,
    ).toBe(false);
    expect(aiRunEventSchema.safeParse({ ...event, sequence: 1 }).success).toBe(false);
  });
});
