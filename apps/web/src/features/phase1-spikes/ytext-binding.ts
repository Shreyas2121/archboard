import type * as Y from 'yjs';

export interface YTextBinding {
  readonly control: HTMLTextAreaElement;
  readonly dispose: () => void;
}

interface TextChange {
  readonly index: number;
  readonly deleteCount: number;
  readonly insert: string;
}

function minimalChange(previous: string, next: string): TextChange {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }

  return {
    index: prefix,
    deleteCount: previous.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

function positionAfterInsert(position: number, index: number, length: number): number {
  return position >= index ? position + length : position;
}

function positionAfterDelete(position: number, index: number, length: number): number {
  if (position <= index) return position;
  return position <= index + length ? index : position - length;
}

/** Plain-text Phase 1 spike. Local input mutates Y.Text incrementally; remote deltas patch DOM ranges. */
export function bindYText(control: HTMLTextAreaElement, text: Y.Text): YTextBinding {
  const ownerDoc = text.doc;
  if (ownerDoc === null) throw new Error('Y.Text must be attached to a Y.Doc.');

  const localInputOrigin = Symbol('phase1-ytext-local-input');
  control.value = text.toString();
  let rendered = control.value;

  const onInput = (): void => {
    const next = control.value;
    const change = minimalChange(rendered, next);
    if (change.deleteCount === 0 && change.insert.length === 0) return;

    ownerDoc.transact(() => {
      if (change.deleteCount > 0) text.delete(change.index, change.deleteCount);
      if (change.insert.length > 0) text.insert(change.index, change.insert);
    }, localInputOrigin);
    rendered = text.toString();
  };

  const onTextChange = (event: Y.YTextEvent): void => {
    if (event.transaction.origin === localInputOrigin) return;

    const focused = document.activeElement === control;
    let selectionStart = control.selectionStart;
    let selectionEnd = control.selectionEnd;
    const direction = control.selectionDirection;
    let index = 0;

    for (const operation of event.delta) {
      if (operation.retain !== undefined) {
        index += operation.retain;
      } else if (operation.delete !== undefined) {
        control.setRangeText('', index, index + operation.delete, 'preserve');
        selectionStart = positionAfterDelete(selectionStart, index, operation.delete);
        selectionEnd = positionAfterDelete(selectionEnd, index, operation.delete);
      } else if (typeof operation.insert === 'string') {
        control.setRangeText(operation.insert, index, index, 'preserve');
        selectionStart = positionAfterInsert(selectionStart, index, operation.insert.length);
        selectionEnd = positionAfterInsert(selectionEnd, index, operation.insert.length);
        index += operation.insert.length;
      }
    }

    rendered = text.toString();
    if (focused) control.setSelectionRange(selectionStart, selectionEnd, direction);
  };

  control.addEventListener('input', onInput);
  text.observe(onTextChange);
  return {
    control,
    dispose: () => {
      control.removeEventListener('input', onInput);
      text.unobserve(onTextChange);
    },
  };
}
