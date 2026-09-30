import type { Node } from '@xyflow/react';

export class CanvasGestures {
  public readonly activeIds = new Set<string>();

  public begin(ids: readonly string[]): void {
    for (const id of ids) this.activeIds.add(id);
  }

  public finish(ids: readonly string[]): boolean {
    const active = ids.some((id) => this.activeIds.has(id));
    for (const id of ids) this.activeIds.delete(id);
    return active;
  }

  public cancel(): void {
    this.activeIds.clear();
  }

  public retain(liveIds: ReadonlySet<string>): void {
    for (const id of this.activeIds) {
      if (!liveIds.has(id)) this.activeIds.delete(id);
    }
  }
}

/** Only temporary geometry belongs to a gesture; document data stays current. */
export function reconcileCanvasNodes<T extends Node>(
  current: readonly T[],
  projected: readonly T[],
  activeIds: ReadonlySet<string>,
): T[] {
  const previous = new Map(current.map((node) => [node.id, node]));
  return projected.map((node) => {
    const temporary = previous.get(node.id);
    if (!activeIds.has(node.id) || temporary === undefined) return node;
    return {
      ...node,
      position: temporary.position,
      style: {
        ...node.style,
        ...(temporary.style?.width === undefined ? {} : { width: temporary.style.width }),
        ...(temporary.style?.height === undefined ? {} : { height: temporary.style.height }),
      },
      ...(temporary.width === undefined ? {} : { width: temporary.width }),
      ...(temporary.height === undefined ? {} : { height: temporary.height }),
      ...(temporary.measured === undefined ? {} : { measured: temporary.measured }),
      ...(temporary.dragging === undefined ? {} : { dragging: temporary.dragging }),
      ...(temporary.resizing === undefined ? {} : { resizing: temporary.resizing }),
    };
  });
}
