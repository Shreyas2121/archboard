import { useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_BOARD_TITLE_CHARACTERS,
  importBoardSchema,
  importBoardResponseSchema,
  type ExportEnvelope,
} from '@archboard/contracts';
import { parsePortableJson } from '@archboard/export';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { boardListQueryKey } from '@/features/boards/board-resource-refresh';
import { usePortabilityScope } from './use-portability-scope';
import { usePortableCreation } from './use-portable-creation';
import { CreationFeedback } from './creation-feedback';
import { inspectVisibleBoards } from './inspect-boards';
import { JSON_PREVIEW_INDENT, isNewPrivateBoard } from './portability-policy';

export function ImportControl({ accountId }: { readonly accountId: string }) {
  const scope = usePortabilityScope(accountId, 'import');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<ExportEnvelope | null>(null);
  const [filename, setFilename] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const readGeneration = useRef(0);
  const [results, setResults] = useState<string[]>([]);
  async function inspect() {
    setResults(await inspectVisibleBoards(scope));
  }
  const creation = usePortableCreation(
    scope,
    '/imports',
    importBoardResponseSchema.refine((result) => isNewPrivateBoard(result.data, accountId)),
    (result) => {
      void scope.client.invalidateQueries({ queryKey: boardListQueryKey(scope.origin, accountId) });
      void navigate({ to: '/boards/$boardId', params: { boardId: result.data.id } });
    },
    inspect,
  );
  async function preview(selected: File | undefined) {
    const generation = ++readGeneration.current;
    const token = scope.capture();
    setFile(null);
    setError('');
    setResults([]);
    setFilename(selected?.name ?? '');
    setReading(false);
    if (!selected) return;
    setReading(true);
    try {
      if (selected.size > MAX_IMPORT_FILE_BYTES)
        throw new Error('File exceeds 5 MiB. Select a smaller file; no board was created.');
      const bytes = new Uint8Array(await selected.arrayBuffer());
      if (!scope.current() || generation !== readGeneration.current) return;
      if (scope.capture() !== token) {
        setError(
          'Access was refreshed while reading. Select the file again to validate it for this account.',
        );
        return;
      }
      const parsed = parsePortableJson(bytes);
      setFile(parsed);
      setTitle(parsed.board.title);
    } catch (cause) {
      if (scope.current() && generation === readGeneration.current)
        setError(cause instanceof Error ? cause.message : 'Invalid JSON file.');
    } finally {
      if (scope.alive() && generation === readGeneration.current) setReading(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="lg">
          Import JSON
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Import JSON as a new private board</DialogTitle>
          <DialogDescription>
            Select an Archboard version 1 UTF-8 JSON file, up to 5 MiB. Preview validates all
            content without executing code or loading URLs. Creation requires signing in online.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor="portable-file">JSON file</Label>
        <Input
          id="portable-file"
          aria-invalid={!!error}
          aria-describedby={error ? 'portable-file-error' : undefined}
          type="file"
          accept=".json,application/json"
          disabled={creation.busy || creation.intent !== null}
          onChange={(event) => void preview(event.target.files?.[0])}
        />
        {filename && <p className="break-all text-sm">Selected: {filename}</p>}
        {reading && <p role="status">Reading and validating the complete file…</p>}
        {error && (
          <p id="portable-file-error" role="alert" className="whitespace-pre-wrap text-destructive">
            {error}
          </p>
        )}
        {file && (
          <section
            aria-label="Validated import preview"
            className="grid gap-2 rounded-lg border p-3"
          >
            <h2 className="font-medium">{file.board.title}</h2>
            <p className="whitespace-pre-wrap text-sm">{file.board.description}</p>
            <p>
              {file.graph.nodes.length} cards · {file.graph.edges.length} connections ·{' '}
              {file.graph.boundaries.length} boundaries · {file.graph.steps.length} steps
            </p>
            <p className="text-sm">
              File label: {file.syncStatusAtExport}. This label grants no server-save state to the
              new board.
            </p>
            <details>
              <summary>Preview full graph as text</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(file.graph, null, JSON_PREVIEW_INDENT)}
              </pre>
            </details>
          </section>
        )}
        <Label htmlFor="import-title">New board title</Label>
        <Input
          id="import-title"
          maxLength={MAX_BOARD_TITLE_CHARACTERS}
          value={title}
          disabled={creation.busy || creation.intent !== null}
          onChange={(event) => setTitle(event.target.value)}
        />
        {!scope.readable && (
          <p role="status">Reconnect and authenticate before creating the board.</p>
        )}
        <Button
          type="button"
          disabled={
            !scope.readable ||
            !file ||
            reading ||
            creation.busy ||
            (!!creation.intent && !creation.intent.retryable(Date.now()))
          }
          onClick={() => void creation.submit(() => importBoardSchema.parse({ title, file }))}
        >
          {creation.busy
            ? 'Creating…'
            : creation.intent
              ? 'Retry identical import request'
              : 'Create private board from this file'}
        </Button>
        <CreationFeedback {...creation} />
        {!!results.length && (
          <section aria-label="Reviewed board results">
            <p>Current visible boards; matching titles do not prove receipt identity:</p>
            {results.map((result) => (
              <p key={result} className="break-all text-sm">
                {result}
              </p>
            ))}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
