import { applicationIdSchema, type GraphProjection } from '@archboard/contracts';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from '@archboard/sync-client';
import { z } from 'zod';
import * as Y from 'yjs';
import {
  COMMAND_ORIGINS,
  createGraphObjects,
  createPresentationStep,
} from '@archboard/document-model';
import { preflightAiDiagram } from './ai-diagram-draft';
import type { EditorSession } from '../application/editor-session';
import type { AiDiagramDraft } from './ai-diagram-draft';
import { RECEIPT_WINDOW_MS } from '../portability/portability-policy';

const MAX_INTENTS = 64;
const MAX_IMPORT_INTENT_CHARACTERS = 524_288;
const MAX_JOURNAL_CHARACTERS = 1_048_576;
const intentSchema = z.strictObject({
  kind: z.literal('scoped-edit').optional(),
  ids: z.record(z.string(), applicationIdSchema),
  state: z.enum(['prepared', 'applied']),
  newBoardId: applicationIdSchema.optional(),
  import: z
    .strictObject({
      key: applicationIdSchema,
      json: z.string().max(MAX_IMPORT_INTENT_CHARACTERS).optional(),
      startedAt: z.number().int().nonnegative(),
      state: z.enum(['pending', 'uncertain', 'rejected']),
    })
    .optional(),
});
const journalSchema = z.record(applicationIdSchema, intentSchema);
export type AiApplyIntent = z.infer<typeof intentSchema>;
type IntentStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** IDs and a bounded outstanding import receipt, outside Y.Doc in the board namespace. */
export class AiApplyJournal {
  private readonly key: string;
  public constructor(
    namespace: BoardStorageNamespace,
    private readonly storage: IntentStorage,
    private readonly now: () => number = Date.now,
  ) {
    this.key = `archboard:ai-apply:${boardStorageNamespaceKey(namespace)}`;
  }
  private read() {
    const raw = this.storage.getItem(this.key);
    if (raw && raw.length > MAX_JOURNAL_CHARACTERS)
      throw new Error('Apply recovery journal is too large.');
    const records = journalSchema.parse(raw ? JSON.parse(raw) : {});
    let expired = false;
    for (const intent of Object.values(records)) {
      if (intent.import?.json && this.now() - intent.import.startedAt >= RECEIPT_WINDOW_MS) {
        delete intent.import.json;
        intent.import.state = 'uncertain';
        expired = true;
      }
    }
    if (expired) this.write(records);
    return records;
  }
  private write(records: z.infer<typeof journalSchema>) {
    const json = JSON.stringify(records);
    if (json.length > MAX_JOURNAL_CHARACTERS) throw new Error('Apply recovery storage is full.');
    this.storage.setItem(this.key, json);
  }
  public get(runId: string): AiApplyIntent | undefined {
    return this.read()[applicationIdSchema.parse(runId)];
  }
  public list(): Readonly<Record<string, AiApplyIntent>> {
    return this.read();
  }
  public prepare(
    runId: string,
    ids: Readonly<Record<string, string>>,
    kind?: 'scoped-edit',
  ): AiApplyIntent {
    applicationIdSchema.parse(runId);
    const records = this.read();
    const existing = records[runId];
    if (existing) {
      if (
        Object.keys(existing.ids).length !== Object.keys(ids).length ||
        Object.entries(existing.ids).some(([key, id]) => ids[key] !== id)
      )
        throw new Error(
          'The original Apply IDs must be recovered; a replacement batch is blocked.',
        );
      return existing;
    }
    if (Object.keys(records).length >= MAX_INTENTS)
      throw new Error('This board’s Apply recovery journal is full. No diagram was applied.');
    const intent = intentSchema.parse({ ids, state: 'prepared', ...(kind ? { kind } : {}) });
    if (new Set(Object.values(intent.ids)).size !== Object.keys(intent.ids).length)
      throw new Error('Apply IDs must be unique.');
    records[runId] = intent;
    this.write(records);
    return intent;
  }
  public complete(runId: string): void {
    const records = this.read();
    const intent = records[runId];
    if (!intent) throw new Error('Apply intent is missing.');
    records[runId] = { ...intent, state: 'applied' };
    this.write(records);
  }
  public saveImport(runId: string, value: AiApplyIntent['import'], newBoardId?: string): void {
    const records = this.read();
    const intent = records[runId];
    if (!intent) throw new Error('Apply intent is missing.');
    const next = {
      ...intent,
      ...(value ? { import: value } : {}),
      ...(newBoardId ? { newBoardId } : {}),
    };
    if (!value) delete next.import;
    records[runId] = intentSchema.parse(next);
    this.write(records);
  }
}

/** Tombstoned IDs also count: deletion must never silently re-create a proposal. */
export function aiCreatedIdsState(document: Y.Doc, ids: Readonly<Record<string, string>>) {
  const values = Object.values(ids);
  const occupied = new Set(
    [...document.share.values()].flatMap((root) => (root instanceof Y.Map ? [...root.keys()] : [])),
  );
  const count = values.filter((id) => occupied.has(id)).length;
  return count === 0 ? 'absent' : count === values.length ? 'present' : 'partial';
}

/** Synchronous preflight and structural transaction: one ordinary persisted/outbox update. */
export function applyAiGraphBatch(document: Y.Doc, graph: GraphProjection): void {
  preflightAiDiagram(Y.encodeStateAsUpdate(document), graph, { clientId: document.clientID });
  document.transact(() => {
    createGraphObjects(document, graph);
    for (const step of graph.steps) createPresentationStep(document, step);
  }, COMMAND_ORIGINS.LOCAL_STRUCTURAL);
}

export function applyReviewedAiDiagram(
  session: Pick<EditorSession, 'canEdit' | 'inspectAiCreatedIds' | 'applyAiDiagram'> & {
    getSnapshot: () => { readonly projection: GraphProjection | null };
  },
  journal: AiApplyJournal,
  runId: string,
  draft: AiDiagramDraft,
  expected: GraphProjection | null,
  allowed: () => boolean,
): void {
  if (!allowed() || !session.canEdit() || session.getSnapshot().projection !== expected)
    throw new Error('Board content or access changed. Prepare and review the draft again.');
  const prior = journal.get(runId);
  const presence = session.inspectAiCreatedIds(draft.ids);
  if (presence !== 'absent' && !prior)
    throw new Error('Fresh Apply IDs conflict with existing objects. No graph changes were made.');
  const intent = journal.prepare(runId, draft.ids);
  if (intent.state === 'applied' || presence === 'present') return;
  if (presence === 'partial')
    throw new Error('Original Apply IDs conflict. No new batch was created.');
  session.applyAiDiagram(draft.graph);
}
