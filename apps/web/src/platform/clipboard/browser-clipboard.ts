import type { ClipboardReadResult, ClipboardWriteResult } from './clipboard-types';

export class BrowserClipboard {
  private sessionText: string | null = null;

  public async writeText(text: string): Promise<ClipboardWriteResult> {
    this.sessionText = text;
    try {
      await navigator.clipboard.writeText(text);
      return { systemWritten: true };
    } catch {
      return { systemWritten: false };
    }
  }

  public async readText(): Promise<ClipboardReadResult | null> {
    try {
      return {
        source: 'system',
        text: await navigator.clipboard.readText(),
        systemDenied: false,
      };
    } catch {
      return this.sessionText === null
        ? null
        : { source: 'session', text: this.sessionText, systemDenied: true };
    }
  }

  public clear(): void {
    this.sessionText = null;
  }
}
