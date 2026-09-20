export interface ClipboardReadResult {
  readonly source: 'system' | 'session';
  readonly text: string;
  readonly systemDenied: boolean;
}

export interface ClipboardWriteResult {
  readonly systemWritten: boolean;
}
