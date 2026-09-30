/** Transient rendering identities; the document remains the graph authority. */
export class CanvasRenderCache<T> {
  private readonly entries = new Map<
    string,
    { readonly inputs: readonly unknown[]; readonly value: T }
  >();

  public get(id: string, inputs: readonly unknown[], build: () => T): T {
    const previous = this.entries.get(id);
    if (
      previous &&
      inputs.length === previous.inputs.length &&
      inputs.every((input, index) => Object.is(input, previous.inputs[index]))
    )
      return previous.value;
    const value = build();
    this.entries.set(id, { inputs, value });
    return value;
  }

  public retain(ids: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
  }
}
