/* eslint-disable @typescript-eslint/no-magic-numbers -- Character offsets are explicit fixture expectations. */
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { mountYTextSpike, type YTextSpike } from './ytext-spike.js';

const docs: Y.Doc[] = [];
const spikes: YTextSpike[] = [];

function createReplica(initial: string): { doc: Y.Doc; text: Y.Text } {
  const doc = new Y.Doc();
  docs.push(doc);
  const text = doc.getText('spike-text');
  if (initial) text.insert(0, initial);
  return { doc, text };
}

function mount(text: Y.Text): YTextSpike {
  const container = document.createElement('div');
  document.body.append(container);
  const spike = mountYTextSpike(container, text);
  spikes.push(spike);
  return spike;
}

function nativeInput(control: HTMLTextAreaElement, insert: string): void {
  control.setRangeText(insert, control.selectionStart, control.selectionEnd, 'end');
  control.dispatchEvent(
    new InputEvent('input', { bubbles: true, data: insert, inputType: 'insertText' }),
  );
}

afterEach(() => {
  for (const spike of spikes.splice(0)) {
    spike.dispose();
    spike.container.remove();
  }
  for (const doc of docs.splice(0)) doc.destroy();
});

describe('ytext browser-backed units', () => {
  it('binds a native textarea keystroke as a single incremental Y.Text insert', () => {
    const { text } = createReplica('hello');
    const spike = mount(text);
    const observed: unknown[] = [];
    text.observe((event) => observed.push(event.delta));
    spike.control.focus();
    spike.control.setSelectionRange(2, 2);

    nativeInput(spike.control, 'X');

    expect(text.toString()).toBe('heXllo');
    expect(spike.control.value).toBe('heXllo');
    expect(spike.control.selectionStart).toBe(3);
    expect(observed).toEqual([[{ retain: 2 }, { insert: 'X' }]]);
  });

  it('turns a native backspace into only the affected Y.Text deletion', () => {
    const { text } = createReplica('abcde');
    const spike = mount(text);
    const observed: unknown[] = [];
    text.observe((event) => observed.push(event.delta));
    spike.control.focus();
    spike.control.setSelectionRange(3, 3);
    spike.control.setRangeText('', 2, 3, 'end');
    spike.control.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
    );

    expect(text.toString()).toBe('abde');
    expect(spike.control.value).toBe('abde');
    expect(spike.control.selectionStart).toBe(2);
    expect(observed).toEqual([[{ retain: 2 }, { delete: 1 }]]);
  });

  it('keeps a second control on the same Y.Text current after local input', () => {
    const { text } = createReplica('abc');
    const first = mount(text);
    const second = mount(text);
    first.control.focus();
    first.control.setSelectionRange(1, 1);

    nativeInput(first.control, 'X');

    expect(text.toString()).toBe('aXbc');
    expect(first.control.value).toBe('aXbc');
    expect(second.control.value).toBe('aXbc');
  });

  it('merges a remote insert from an independent Y.Doc and maps the caret', () => {
    const local = createReplica('hello');
    const remote = createReplica('');
    Y.applyUpdate(remote.doc, Y.encodeStateAsUpdate(local.doc));
    const spike = mount(local.text);
    spike.control.focus();
    spike.control.setSelectionRange(2, 2);

    remote.text.insert(0, 'R');
    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(remote.doc, Y.encodeStateVector(local.doc)));

    expect(local.text.toString()).toBe('Rhello');
    expect(remote.text.toString()).toBe('Rhello');
    expect(spike.control.value).toBe('Rhello');
    expect(spike.control.selectionStart).toBe(3);
    expect(spike.control.selectionEnd).toBe(3);
  });

  it('keeps a selected range sensible through a remote insert and delete', () => {
    const local = createReplica('abcdef');
    const remote = createReplica('');
    Y.applyUpdate(remote.doc, Y.encodeStateAsUpdate(local.doc));
    const spike = mount(local.text);
    spike.control.focus();
    spike.control.setSelectionRange(2, 4);

    remote.text.insert(0, 'X');
    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(remote.doc, Y.encodeStateVector(local.doc)));
    expect(spike.control.value).toBe('Xabcdef');
    expect([spike.control.selectionStart, spike.control.selectionEnd]).toEqual([3, 5]);

    remote.text.delete(0, 1);
    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(remote.doc, Y.encodeStateVector(local.doc)));
    expect(spike.control.value).toBe('abcdef');
    expect([spike.control.selectionStart, spike.control.selectionEnd]).toEqual([2, 4]);
  });

  it('expands a selected range when a remote insertion lands inside it', () => {
    const local = createReplica('abcdef');
    const remote = createReplica('');
    Y.applyUpdate(remote.doc, Y.encodeStateAsUpdate(local.doc));
    const spike = mount(local.text);
    spike.control.focus();
    spike.control.setSelectionRange(2, 4);

    remote.text.insert(3, 'X');
    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(remote.doc, Y.encodeStateVector(local.doc)));

    expect(spike.control.value).toBe('abcXdef');
    expect([spike.control.selectionStart, spike.control.selectionEnd]).toEqual([2, 5]);
  });

  it('converges concurrent local and remote inserts without replacing either string', () => {
    const local = createReplica('hello');
    const remote = createReplica('');
    Y.applyUpdate(remote.doc, Y.encodeStateAsUpdate(local.doc));
    const spike = mount(local.text);
    spike.control.focus();
    spike.control.setSelectionRange(5, 5);
    nativeInput(spike.control, '!');
    remote.text.insert(0, 'R');

    Y.applyUpdate(local.doc, Y.encodeStateAsUpdate(remote.doc, Y.encodeStateVector(local.doc)));
    Y.applyUpdate(remote.doc, Y.encodeStateAsUpdate(local.doc, Y.encodeStateVector(remote.doc)));

    expect(local.text.toString()).toBe('Rhello!');
    expect(remote.text.toString()).toBe('Rhello!');
    expect(spike.control.value).toBe('Rhello!');
    expect(spike.control.selectionStart).toBe(7);
  });
});
