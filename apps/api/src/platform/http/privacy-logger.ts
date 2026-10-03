import type { LoggerService } from '@nestjs/common';

/** Framework/driver exceptions can contain SQL, credentials and token-bearing URLs. */
export class PrivacyLogger implements LoggerService {
  private emit(level: string): void {
    try {
      console.info(JSON.stringify({ event: 'framework.diagnostic', level }));
    } catch {
      // Diagnostics must not interfere with runtime admission or shutdown.
    }
  }

  public log(): void {
    this.emit('info');
  }
  public error(): void {
    this.emit('error');
  }
  public warn(): void {
    this.emit('warn');
  }
  public debug(): void {
    this.emit('debug');
  }
  public verbose(): void {
    this.emit('verbose');
  }
  public fatal(): void {
    this.emit('fatal');
  }
}
