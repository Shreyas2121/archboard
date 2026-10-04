import { aiRunEventSchema, MAX_AI_EVENT_BYTES, type AiRunEvent } from '@archboard/contracts';

export const MAX_AI_STREAM_BYTES = 65_536;
const MAX_AI_STREAM_FRAMES = 64;
/** Incremental UTF-8/SSE decoding; IDs mark snapshots, never a gap-free event log. */
export class AiEventParser {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private bytes = 0;
  private frames = 0;
  private line = '';
  private skipLf = false;
  private data: string[] = [];
  private id: string | null = null;
  private event: string | null = null;
  private frameBytes = 0;
  public constructor(private readonly runId: string) {}
  public push(bytes: Uint8Array): AiRunEvent[] {
    this.bytes += bytes.byteLength;
    if (this.bytes > MAX_AI_STREAM_BYTES) throw new Error('AI event stream exceeded its bound.');
    return this.consume(this.decoder.decode(bytes, { stream: true }));
  }
  public finish(): AiRunEvent[] {
    const events = this.consume(this.decoder.decode());
    if (this.line || this.data.length || this.id !== null || this.event !== null)
      throw new Error('AI event stream ended with an incomplete frame.');
    return events;
  }
  private consume(text: string): AiRunEvent[] {
    const events: AiRunEvent[] = [];
    for (const character of text) {
      if (this.skipLf && character === '\n') {
        this.skipLf = false;
        continue;
      }
      this.skipLf = character === '\r';
      this.frameBytes += this.encoder.encode(character).byteLength;
      if (this.frameBytes > MAX_AI_EVENT_BYTES)
        throw new Error('AI event frame exceeded its bound.');
      if (character !== '\r' && character !== '\n') {
        this.line += character;
        continue;
      }
      if (!this.line) {
        this.frames++;
        if (this.frames > MAX_AI_STREAM_FRAMES) throw new Error('Too many AI event frames.');
        if (this.data.length) {
          const parsed = aiRunEventSchema.parse(JSON.parse(this.data.join('\n')));
          if (
            parsed.runId !== this.runId ||
            parsed.sequence !== this.id ||
            parsed.type !== this.event
          )
            throw new Error('AI event binding did not match.');
          // Deltas cannot establish success and are deliberately not exposed by this transport.
          if (parsed.type !== 'text-delta') events.push(parsed);
        } else if (this.id !== null || this.event !== null)
          throw new Error('AI event has no data.');
        this.data = [];
        this.id = null;
        this.event = null;
        this.frameBytes = 0;
      } else if (!this.line.startsWith(':')) {
        const colon = this.line.indexOf(':');
        const field = colon < 0 ? this.line : this.line.slice(0, colon);
        const value = colon < 0 ? '' : this.line.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') this.data.push(value);
        else if (field === 'id' && this.id === null) this.id = value;
        else if (field === 'event' && this.event === null) this.event = value;
        else throw new Error('Unsupported AI event field.');
      }
      this.line = '';
    }
    return events;
  }
}
