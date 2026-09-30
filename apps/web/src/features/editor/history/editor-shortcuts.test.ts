import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldIgnoreEditorShortcut } from './editor-shortcuts';

class Target extends EventTarget {
  public constructor(private readonly matched: boolean) {
    super();
  }
  public closest(): Target | null {
    return this.matched ? this : null;
  }
}
const event = { defaultPrevented: false, isComposing: false, target: null };
const scope = (open: boolean) =>
  ({ querySelector: () => (open ? {} : null) }) as unknown as Document;
afterEach(() => vi.unstubAllGlobals());

describe('editor shortcut ownership', () => {
  it('blocks explicit modal ownership before dialog content mounts', () => {
    expect(shouldIgnoreEditorShortcut(event, scope(false), true)).toBe(true);
  });
  it.each(['help', 'reset', 'delete', 'storage', 'server reload'])(
    'blocks commands while %s owns a dialog',
    () => {
      expect(shouldIgnoreEditorShortcut(event, scope(true))).toBe(true);
    },
  );
  it('respects handled events and IME composition', () => {
    expect(shouldIgnoreEditorShortcut({ ...event, defaultPrevented: true }, scope(false))).toBe(
      true,
    );
    expect(shouldIgnoreEditorShortcut({ ...event, isComposing: true }, scope(false))).toBe(true);
  });
  it('blocks editable and dialog descendants; permits canvas commands after close', () => {
    vi.stubGlobal('Element', Target);
    expect(shouldIgnoreEditorShortcut({ ...event, target: new Target(true) }, scope(false))).toBe(
      true,
    );
    expect(shouldIgnoreEditorShortcut({ ...event, target: new Target(false) }, scope(false))).toBe(
      false,
    );
  });
});
