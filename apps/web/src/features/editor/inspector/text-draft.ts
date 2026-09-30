import type { GraphTextDelta, TextEdit } from '@archboard/document-model';

export function minimalTextChange(previous: string, next: string): TextEdit {
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

// Each current UTF-16 unit points to its position in the draft baseline. Peer
// insertions have no baseline position and must never be deleted by this draft.
export class TextDraft {
  private positions: (number | null)[];

  public constructor(public readonly baseline: string) {
    this.positions = Array.from({ length: baseline.length }, (_, index) => index);
  }

  public receive(delta: GraphTextDelta): void {
    let index = 0;
    for (const change of delta) {
      if (change.retain !== undefined) index += change.retain;
      if (change.delete !== undefined) this.positions.splice(index, change.delete);
      if (change.insert !== undefined) {
        const inserted = Array.from({ length: change.insert.length }, () => null);
        this.positions = [
          ...this.positions.slice(0, index),
          ...inserted,
          ...this.positions.slice(index),
        ];
        index += inserted.length;
      }
    }
  }

  public edits(value: string): readonly TextEdit[] {
    const intent = minimalTextChange(this.baseline, value);
    const end = intent.index + intent.deleteCount;
    const anchor = this.positions.findIndex(
      (position) => position !== null && position >= intent.index,
    );
    const insertionIndex = anchor === -1 ? this.positions.length : anchor;
    const deletions: TextEdit[] = [];
    this.positions.forEach((position, index) => {
      if (position === null || position < intent.index || position >= end) return;
      const previous = deletions.at(-1);
      if (previous !== undefined && previous.index + previous.deleteCount === index) {
        deletions[deletions.length - 1] = { ...previous, deleteCount: previous.deleteCount + 1 };
      } else {
        deletions.push({ index, deleteCount: 1, insert: '' });
      }
    });
    // Delete from the end so offsets remain valid, then insert at the surviving
    // anchor. A peer deletion of that anchor moves insertion to the next survivor.
    const edits = deletions.reverse();
    if (intent.insert.length > 0) {
      edits.push({ index: insertionIndex, deleteCount: 0, insert: intent.insert });
    }
    return edits;
  }
}
