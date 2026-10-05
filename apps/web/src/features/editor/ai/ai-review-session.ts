import {
  aiCreateRunSchema,
  applicationIdSchema,
  MAX_AI_CONTEXT_FILE_BYTES,
  type AiRun,
  type AiAvailability,
  type AiCreateRun,
} from '@archboard/contracts';
import type { AiTransport } from '@/platform/api/ai-api';
import { ApiClientError } from '@/platform/api/api-client';
import {
  emptyAiForm,
  contextFromForm,
  reviewAiRequest,
  parseAiContext,
  aiValidationMessage,
  AI_RECEIPT_WINDOW_MS,
  type AiContextForm,
} from './ai-review-model';

export interface AiReviewState {
  readonly prompt: string;
  readonly form: AiContextForm;
  readonly mode: 'prompt' | 'form' | 'file';
  readonly context: AiCreateRun['context'] | null;
  readonly filename: string;
  readonly reading: boolean;
  readonly review: AiCreateRun | null;
  readonly intent: { key: string; json: string; startedAt: number } | null;
  readonly phase:
    'draft' | 'reviewed' | 'submitting' | 'uncertain' | 'rejected' | 'known' | 'expired';
  readonly run: AiRun | null;
  readonly availability: AiAvailability | null;
  readonly busy: boolean;
  readonly observing: boolean;
  readonly problem: string;
  readonly retryAfterSeconds: number | null;
}
const initial = (): AiReviewState => ({
  prompt: '',
  form: emptyAiForm(),
  mode: 'prompt',
  context: null,
  filename: '',
  reading: false,
  review: null,
  intent: null,
  phase: 'draft',
  run: null,
  availability: null,
  busy: false,
  observing: false,
  problem: '',
  retryAfterSeconds: null,
});
const pending = (run: AiRun | null) => run?.content.status === 'pending';
/** Session-only private state. No graph, storage, outbox or query-cache writes. */
export class AiReviewSession {
  private state = initial();
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private fileEpoch = 0;
  private alive = true;
  private request: AbortController | null = null;
  private stream: AbortController | null = null;
  private lastId: string | undefined;
  private blocked = false;
  private availabilityRequest: AbortController | null = null;
  public constructor(
    private readonly boardId: string,
    private readonly transport: AiTransport,
    private readonly allowed: () => boolean,
    private readonly online: () => boolean,
    private readonly key: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now,
    private readonly authenticate: (signal: AbortSignal) => Promise<void> = async () => undefined,
  ) {}
  public readonly snapshot = () => this.state;
  public readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(change: Partial<AiReviewState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private accepts(epoch: number) {
    return this.currentScope() && this.epoch === epoch;
  }
  public activate() {
    this.alive = true;
  }
  public clear() {
    this.epoch++;
    this.fileEpoch++;
    this.request?.abort();
    this.stream?.abort();
    this.availabilityRequest?.abort();
    this.request = null;
    this.stream = null;
    this.lastId = undefined;
    this.state = initial();
    for (const listener of this.listeners) listener();
  }
  public dispose() {
    this.alive = false;
    this.clear();
  }
  public pause() {
    this.epoch++;
    this.fileEpoch++;
    this.request?.abort();
    this.stream?.abort();
    this.availabilityRequest?.abort();
    this.request = null;
    this.stream = null;
    this.patch({
      busy: false,
      observing: false,
      reading: false,
      availability: null,
      phase: this.state.phase === 'submitting' ? 'uncertain' : this.state.phase,
      problem: 'Reconnect to check the original request. No generation is queued.',
    });
  }
  public editable() {
    return this.currentScope() && !this.state.intent && !this.state.busy;
  }
  public currentScope() {
    return this.alive && !this.blocked && this.allowed();
  }
  private accessFailure(error: unknown) {
    if (
      error instanceof ApiClientError &&
      (error.kind === 'unauthenticated' ||
        error.code === 'FORBIDDEN' ||
        error.code === 'NOT_FOUND' ||
        error.code === 'BOARD_ARCHIVED')
    ) {
      this.blocked = true;
      this.clear();
      return true;
    }
    return false;
  }
  private acceptRun(run: AiRun, expectedId?: string) {
    if (
      (expectedId && run.id !== expectedId) ||
      (this.state.review && run.task !== this.state.review.task)
    )
      throw new ApiClientError('invalid-response', null, null, 'AI run binding did not match.');
    const previous = this.state.run;
    if (
      previous &&
      (Date.parse(previous.updatedAt) > Date.parse(run.updatedAt) ||
        (previous.content.status !== 'pending' && run.content.status === 'pending') ||
        (previous.content.status === 'expired' && run.content.status === 'available'))
    )
      return;
    this.patch({ run });
  }
  public expire() {
    const run = this.state.run;
    if (
      this.currentScope() &&
      run?.content.status === 'available' &&
      Date.parse(run.content.expiresAt) <= this.now()
    )
      this.patch({
        run: { ...run, content: { status: 'expired', expiredAt: run.content.expiresAt } },
      });
  }
  public draft(change: Partial<Pick<AiReviewState, 'prompt' | 'mode' | 'form'>>) {
    if (!this.editable()) return;
    this.fileEpoch++;
    this.patch({ ...change, reading: false, review: null, phase: 'draft', problem: '' });
  }
  public review() {
    if (!this.editable() || this.state.reading) return;
    try {
      const context =
        this.state.mode === 'form'
          ? contextFromForm(this.state.form)
          : this.state.mode === 'file'
            ? (this.state.context ?? undefined)
            : undefined;
      if (this.state.mode === 'file' && !context)
        throw new Error('Select and validate one JSON context file first.');
      const body = reviewAiRequest(this.state.prompt, this.boardId, context);
      this.patch({ review: body, phase: 'reviewed', problem: '' });
    } catch (error) {
      this.patch({ review: null, problem: aiValidationMessage(error) });
    }
  }
  public async file(
    file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> } | undefined,
  ) {
    if (!this.editable()) return;
    const ticket = ++this.fileEpoch;
    const epoch = this.epoch;
    this.patch({
      mode: 'file',
      filename: file?.name ?? '',
      context: null,
      review: null,
      phase: 'draft',
      reading: !!file,
      problem: '',
    });
    if (!file) return;
    try {
      if (file.size > MAX_AI_CONTEXT_FILE_BYTES) throw new Error('Context file exceeds 1 MiB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!this.accepts(epoch) || ticket !== this.fileEpoch) return;
      this.patch({ context: parseAiContext(bytes) });
    } catch (error) {
      if (this.accepts(epoch) && ticket === this.fileEpoch)
        this.patch({ problem: aiValidationMessage(error) });
    } finally {
      if (this.accepts(epoch) && ticket === this.fileEpoch) this.patch({ reading: false });
    }
  }
  public async availability() {
    if (!this.currentScope() || !this.online()) return;
    const epoch = this.epoch;
    const abort = new AbortController();
    this.availabilityRequest?.abort();
    this.availabilityRequest = abort;
    try {
      const availability = await this.transport.availability(this.boardId, abort.signal);
      if (this.accepts(epoch) && this.availabilityRequest === abort) this.patch({ availability });
    } catch (error) {
      if (this.accepts(epoch) && this.availabilityRequest === abort && !this.accessFailure(error))
        this.patch({ availability: null, problem: aiValidationMessage(error) });
    }
  }
  public canGenerate() {
    return (
      this.editable() &&
      this.online() &&
      this.state.phase === 'reviewed' &&
      this.state.review !== null &&
      this.state.availability?.available === true
    );
  }
  public async generate() {
    if (!this.canGenerate()) return;
    const body = this.state.review!;
    this.patch({ intent: { key: this.key(), json: JSON.stringify(body), startedAt: this.now() } });
    await this.submit(false);
  }
  public canRecover() {
    const intent = this.state.intent;
    return (
      this.currentScope() &&
      this.online() &&
      !this.state.busy &&
      this.state.phase === 'uncertain' &&
      !!intent &&
      this.now() >= intent.startedAt &&
      this.now() - intent.startedAt < AI_RECEIPT_WINDOW_MS
    );
  }
  public async recover() {
    if (this.canRecover()) await this.submit(true);
  }
  private async submit(wasUncertain: boolean) {
    const intent = this.state.intent;
    if (!intent) return;
    const epoch = this.epoch;
    const abort = new AbortController();
    this.request = abort;
    this.patch({ phase: 'submitting', busy: true, problem: '', retryAfterSeconds: null });
    try {
      await this.authenticate(abort.signal);
      if (!this.accepts(epoch) || !this.online() || abort.signal.aborted) return;
      const run = await this.transport.create(
        intent.key,
        aiCreateRunSchema.parse(JSON.parse(intent.json)),
        abort.signal,
      );
      if (!this.accepts(epoch)) return;
      this.acceptRun(run);
      this.patch({ phase: 'known' });
      if (pending(this.state.run)) void this.observe();
    } catch (error) {
      if (!this.accepts(epoch)) return;
      if (this.accessFailure(error)) return;
      const definite =
        error instanceof ApiClientError &&
        error.kind === 'http' &&
        (error.status ?? 0) < HTTP_SERVER_ERROR;
      const expired = error instanceof ApiClientError && error.code === 'AI_RESULT_EXPIRED';
      this.patch({
        phase: expired ? 'expired' : wasUncertain || !definite ? 'uncertain' : 'rejected',
        problem: definite
          ? error.message
          : 'The creation outcome is uncertain. Recover only the original request.',
        retryAfterSeconds: error instanceof ApiClientError ? error.retryAfterSeconds : null,
      });
    } finally {
      if (this.accepts(epoch)) {
        this.request = null;
        this.patch({ busy: false });
      }
    }
  }
  public async refresh(recoveredId?: string) {
    const id = recoveredId ?? this.state.run?.id;
    if (!this.currentScope() || !this.online() || this.state.busy || !id) return;
    if (recoveredId && (this.state.intent || this.state.run)) return;
    applicationIdSchema.parse(id);
    this.stream?.abort();
    const epoch = this.epoch;
    const abort = new AbortController();
    this.request = abort;
    this.patch({ busy: true, observing: false, problem: '' });
    try {
      const run = await this.transport.read(id, abort.signal);
      if (!this.accepts(epoch)) return;
      this.acceptRun(run, id);
      if (recoveredId) this.patch({ phase: 'known' });
      if (pending(this.state.run)) void this.observe();
    } catch (error) {
      if (this.accepts(epoch) && !this.accessFailure(error))
        this.patch({ problem: aiValidationMessage(error) });
    } finally {
      if (this.accepts(epoch)) {
        this.request = null;
        this.patch({ busy: false });
      }
    }
  }
  public async cancel() {
    if (!this.currentScope() || !this.online() || this.state.busy || !pending(this.state.run))
      return;
    const epoch = this.epoch;
    const id = this.state.run!.id;
    this.stream?.abort();
    const abort = new AbortController();
    this.request = abort;
    this.patch({ busy: true, observing: false, problem: '' });
    try {
      const run = await this.transport.cancel(id, abort.signal);
      if (this.accepts(epoch)) this.acceptRun(run, id);
    } catch (error) {
      if (this.accepts(epoch) && !this.accessFailure(error))
        this.patch({
          problem: 'Cancellation could not be confirmed. Check the original run status.',
        });
    } finally {
      if (this.accepts(epoch)) {
        this.request = null;
        this.patch({ busy: false });
      }
    }
  }
  private async observe() {
    this.stream?.abort();
    const run = this.state.run;
    if (!run || !this.currentScope() || !this.online()) return;
    const epoch = this.epoch;
    const abort = new AbortController();
    this.stream = abort;
    this.patch({ observing: true });
    try {
      await this.transport.events(run.id, this.lastId, abort.signal, async (event) => {
        if (!this.accepts(epoch) || abort.signal.aborted || event.runId !== run.id) return;
        this.lastId = event.sequence;
        const current = await this.transport.read(run.id, abort.signal);
        if (this.accepts(epoch) && !abort.signal.aborted) this.acceptRun(current, run.id);
      });
      if (this.accepts(epoch) && !abort.signal.aborted && pending(this.state.run))
        this.patch({
          problem: 'The event connection closed. Check status to reconnect to this run.',
        });
    } catch (error) {
      if (this.accepts(epoch) && !abort.signal.aborted && !this.accessFailure(error))
        this.patch({ problem: 'Events are unavailable. Check status to reconnect to this run.' });
    } finally {
      if (this.accepts(epoch) && this.stream === abort) this.patch({ observing: false });
    }
  }
  public newDraft() {
    if (
      this.state.busy ||
      this.state.phase === 'uncertain' ||
      this.state.phase === 'submitting' ||
      pending(this.state.run) ||
      this.state.run?.state === 'outcome-unknown'
    )
      return;
    this.clear();
  }
}
const HTTP_SERVER_ERROR = 500;
