import { MAX_IMPORT_FILE_BYTES, MAX_CONTENT_BODY_CHARACTERS } from '@archboard/contracts';
import { allEntityGraphFixture } from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import { capturePortableEnvelope, parsePortableJson, serializePortableJson } from './index.js';

const durability = {
  online: true,
  authoritative: true,
  acknowledged: true,
  persistencePending: false,
  outboxPending: false,
};
const INVALID_UTF8_BYTE = 255;
const EXCESSIVE_JSON_DEPTH = 33;
const capture = {
  exportedAt: '2026-10-02T00:00:00.000Z',
  board: { title: 'Portable', description: 'Complete text' },
  graph: allEntityGraphFixture,
};

describe('portable JSON', () => {
  it('round trips every entity kind and full text without changing the source', () => {
    const before = JSON.stringify(capture);
    const envelope = capturePortableEnvelope(capture, durability);
    const result = serializePortableJson(envelope);
    expect(parsePortableJson(new TextEncoder().encode(result.json))).toEqual(envelope);
    expect(result.reimportable).toBe(true);
    expect(JSON.stringify(capture)).toBe(before);
  });
  it.each(['online', 'authoritative', 'acknowledged'] as const)(
    'labels missing %s coverage local-only',
    (key) => {
      expect(
        capturePortableEnvelope(capture, { ...durability, [key]: false }).syncStatusAtExport,
      ).toBe('local-only');
    },
  );
  it.each(['persistencePending', 'outboxPending'] as const)('labels %s local-only', (key) => {
    expect(
      capturePortableEnvelope(capture, { ...durability, [key]: true }).syncStatusAtExport,
    ).toBe('local-only');
  });
  it('rejects oversized bytes, invalid UTF-8, deep nesting and prohibited keys before validation', () => {
    expect(() => parsePortableJson(new Uint8Array(MAX_IMPORT_FILE_BYTES + 1))).toThrow('5 MiB');
    expect(() => parsePortableJson(new Uint8Array([INVALID_UTF8_BYTE]))).toThrow('UTF-8');
    expect(() =>
      parsePortableJson('['.repeat(EXCESSIVE_JSON_DEPTH) + ']'.repeat(EXCESSIVE_JSON_DEPTH)),
    ).toThrow('nesting');
    for (const key of ['__proto__', 'constructor', 'prototype'])
      expect(() => parsePortableJson(`{"${key}":{}}`)).toThrow('prohibited');
  });
  it('rejects unknown/history fields, bad versions and malformed JSON without repair', () => {
    const envelope = capturePortableEnvelope(capture, durability);
    for (const invalid of [
      { ...envelope, comments: [] },
      { ...envelope, formatVersion: 2 },
      { ...envelope, graph: { ...envelope.graph, owner: 'injected' } },
    ])
      expect(() => parsePortableJson(JSON.stringify(invalid))).toThrow();
    expect(() => parsePortableJson('{')).toThrow('JSON');
  });
  it('preserves recovery JSON above the import cap and reports unchanged reimport unavailable', () => {
    const note = allEntityGraphFixture.nodes.find((node) => node.kind === 'note')!;
    const graph = {
      ...allEntityGraphFixture,
      edges: [],
      steps: [],
      nodes: Array.from({ length: 300 }, () => ({
        ...note,
        id: crypto.randomUUID(),
        content: { body: 'x'.repeat(MAX_CONTENT_BODY_CHARACTERS) },
      })),
    };
    const result = serializePortableJson(
      capturePortableEnvelope({ ...capture, graph }, { ...durability, online: false }),
    );
    expect(result.byteLength).toBeGreaterThan(MAX_IMPORT_FILE_BYTES);
    expect(result.reimportable).toBe(false);
    expect(JSON.parse(result.json).graph.nodes[299].content.body).toHaveLength(
      MAX_CONTENT_BODY_CHARACTERS,
    );
    expect(() => parsePortableJson(result.json)).toThrow('5 MiB');
  });
});
