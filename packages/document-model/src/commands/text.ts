import { graphNodeSchema } from '@archboard/contracts';
import type * as Y from 'yjs';

import { getGraphDocumentRoots } from '../schema/document.js';
import { GraphCommandError } from './error.js';
import {
  LOCAL_EDIT_ORIGIN,
  liveBoundary,
  liveEdge,
  liveNode,
  liveStep,
  parseBoundary,
  parseEdge,
  parseStep,
  requireText,
} from './internal.js';

export interface TextEdit {
  readonly index: number;
  readonly deleteCount: number;
  readonly insert: string;
}

export type GraphTextTarget =
  | {
      readonly entity: 'node';
      readonly id: string;
      readonly field: 'title' | 'description' | 'technology' | 'body';
    }
  | { readonly entity: 'edge'; readonly id: string; readonly field: 'label' | 'protocol' }
  | { readonly entity: 'boundary'; readonly id: string; readonly field: 'title' }
  | { readonly entity: 'step'; readonly id: string; readonly field: 'title' | 'notes' };

function editedValue(current: string, edit: TextEdit): string {
  if (!Number.isSafeInteger(edit.index) || !Number.isSafeInteger(edit.deleteCount)) {
    throw new GraphCommandError('Text edit offsets must be safe integers.');
  }
  if (edit.index < 0 || edit.deleteCount < 0 || edit.index + edit.deleteCount > current.length) {
    throw new GraphCommandError('Text edit range is outside the current text.');
  }
  return `${current.slice(0, edit.index)}${edit.insert}${current.slice(edit.index + edit.deleteCount)}`;
}

function validateNodeText(
  document: Y.Doc,
  target: Extract<GraphTextTarget, { entity: 'node' }>,
  value: string,
): void {
  const node = liveNode(document, target.id);
  if (target.field === 'title') {
    graphNodeSchema.parse({ ...node, title: value });
  } else if (target.field === 'description' || target.field === 'technology') {
    if (node.kind !== 'component') {
      throw new GraphCommandError(`Node ${target.id} has no ${target.field} field.`);
    }
    graphNodeSchema.parse({ ...node, content: { ...node.content, [target.field]: value } });
  } else {
    if (node.kind === 'component') {
      throw new GraphCommandError(`Node ${target.id} has no body field.`);
    }
    if (node.kind === 'code') {
      graphNodeSchema.parse({ ...node, content: { ...node.content, body: value } });
    } else {
      graphNodeSchema.parse({ ...node, content: { body: value } });
    }
  }
}

export function resolveGraphText(document: Y.Doc, target: GraphTextTarget): Y.Text {
  const roots = getGraphDocumentRoots(document);
  const root =
    target.entity === 'node'
      ? roots.nodes
      : target.entity === 'edge'
        ? roots.edges
        : target.entity === 'boundary'
          ? roots.boundaries
          : roots.steps;
  if (target.entity === 'node') liveNode(document, target.id);
  else if (target.entity === 'edge') liveEdge(document, target.id);
  else if (target.entity === 'boundary') liveBoundary(document, target.id);
  else liveStep(document, target.id);
  return requireText(
    (root.get(target.id) as Y.Map<unknown>).get(target.field),
    `${target.entity} ${target.id}`,
    target.field,
  );
}

export function editGraphText(
  document: Y.Doc,
  target: GraphTextTarget,
  edit: TextEdit | readonly TextEdit[],
): void {
  const text = resolveGraphText(document, target);
  // Batch offsets refer to the result of the preceding edit. Validate the final
  // value and every range before applying the batch in one local transaction.
  const edits: readonly TextEdit[] = 'index' in edit ? [edit] : edit;
  const value = edits.reduce(editedValue, text.toString());
  if (target.entity === 'node') validateNodeText(document, target, value);
  else if (target.entity === 'edge') {
    parseEdge({ ...liveEdge(document, target.id), [target.field]: value });
  } else if (target.entity === 'boundary') {
    parseBoundary({ ...liveBoundary(document, target.id), title: value });
  } else {
    parseStep({ ...liveStep(document, target.id), [target.field]: value });
  }

  document.transact(() => {
    for (const change of edits) {
      if (change.deleteCount > 0) text.delete(change.index, change.deleteCount);
      if (change.insert.length > 0) text.insert(change.index, change.insert);
    }
  }, LOCAL_EDIT_ORIGIN);
}
