export class GraphCommandError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'GraphCommandError';
  }
}
