export class StartupReadinessUnavailableError extends Error {
  public constructor() {
    super('Startup readiness unavailable.');
    this.name = 'StartupReadinessUnavailableError';
  }
}
