import { useEffect, useRef, useState } from 'react';
import {
  renderControlledSvg,
  IMAGE_SCALE_DOUBLE,
  type ImageScale,
  type ImageExportOptions,
} from '@archboard/export';
import { readLocalSignOutPending, readSelectedAccountMarker } from '@archboard/sync-client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTheme } from '@/app/theme/theme-provider';
import { downloadDiagramImage } from '@/platform/download/image-download';
import { useEditorSelection } from '../state';
import type { EditorSession } from '../application';

export function ImageExportControl({
  session,
  title,
  open,
  onOpenChange,
}: {
  readonly session: EditorSession;
  readonly title: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { resolvedTheme } = useTheme();
  const selection = useEditorSelection();
  const [scope, setScope] = useState<ImageExportOptions['scope']>('diagram');
  const [background, setBackground] = useState(true);
  const [scale, setScale] = useState<ImageScale>(1);
  const [state, setState] = useState<'idle' | 'preparing' | 'downloading'>('idle');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const flight = useRef<AbortController | null>(null);
  const active = useRef(false);
  const scopeIdentity = session.resourceScope;
  function current() {
    if (!active.current) return false;
    if (!scopeIdentity) return true;
    try {
      return (
        readLocalSignOutPending(scopeIdentity.deploymentOrigin) === null &&
        readSelectedAccountMarker(scopeIdentity.deploymentOrigin) === scopeIdentity.accountId
      );
    } catch {
      return false;
    }
  }
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      flight.current?.abort();
    };
  }, [session]);
  async function exportImage(format: 'svg' | 'png') {
    if (flight.current || !current()) return;
    const controller = new AbortController();
    flight.current = controller;
    setState('preparing');
    setMessage('');
    setFailed(false);
    try {
      const projection = session.getSnapshot().projection;
      if (!projection) throw new Error('No local graph is available for image export.');
      // Capture before any await. Renderer clones graph and consumes a single selection/theme snapshot.
      const image = renderControlledSvg(projection, {
        scope,
        selection: [...selection],
        background,
        theme: resolvedTheme,
      });
      await downloadDiagramImage(image, title, format, scale, controller.signal, () => {
        if (!current()) {
          controller.abort();
          return;
        }
        setState('downloading');
      });
      if (current())
        setMessage(
          `Download requested: ${image.width * (format === 'png' ? scale : 1)} × ${image.height * (format === 'png' ? scale : 1)} ${format.toUpperCase()}.${image.omittedEdges ? ` ${image.omittedEdges} connections with unavailable endpoints were omitted.` : ''}`,
        );
    } catch (cause) {
      if (current()) setFailed(true);
      if (current())
        setMessage(
          cause instanceof Error || cause instanceof DOMException
            ? cause.message
            : 'Image export failed. Retry or download SVG/JSON.',
        );
    } finally {
      flight.current = null;
      if (active.current) setState('idle');
    }
  }
  const busy = state !== 'idle';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) flight.current?.abort();
        onOpenChange(next);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          Export image
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export diagram image</DialogTitle>
          <DialogDescription>
            Export the available local graph, including pending edits. Text wrapping may differ from
            the editor. Long card text is clipped with an overflow indicator; full JSON preserves
            all text.
          </DialogDescription>
        </DialogHeader>
        <Label htmlFor="image-scope">Image scope</Label>
        <Select
          value={scope}
          disabled={busy}
          onValueChange={(value) => setScope(value === 'selection' ? 'selection' : 'diagram')}
        >
          <SelectTrigger id="image-scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="diagram">Entire diagram</SelectItem>
            <SelectItem value="selection">Current selection</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm">
          Selection includes selected cards and boundaries. Selected connections include their
          endpoints; all internal connections are included. Boundaries do not automatically select
          contained cards.
        </p>
        <Label htmlFor="image-background">Background</Label>
        <Select
          value={background ? 'on' : 'off'}
          disabled={busy}
          onValueChange={(value) => setBackground(value === 'on')}
        >
          <SelectTrigger id="image-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="on">Current theme background</SelectItem>
            <SelectItem value="off">Transparent</SelectItem>
          </SelectContent>
        </Select>
        <Label htmlFor="image-scale">PNG scale</Label>
        <Select
          value={String(scale)}
          disabled={busy}
          onValueChange={(value) => setScale(value === '2' ? IMAGE_SCALE_DOUBLE : 1)}
        >
          <SelectTrigger id="image-scale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1×</SelectItem>
            <SelectItem value="2">2×</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">
          Maximum 8,192 pixels per side and 32 megapixels. SVG uses 1× geometry. External URLs
          remain plain text; images contain no editor controls or presentation overlays.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => void exportImage('svg')}>
            Download SVG
          </Button>
          <Button type="button" disabled={busy} onClick={() => void exportImage('png')}>
            Download PNG
          </Button>
          {busy && (
            <Button type="button" variant="outline" onClick={() => flight.current?.abort()}>
              Cancel image export
            </Button>
          )}
        </div>
        {busy && (
          <p role="status">{state === 'preparing' ? 'Preparing image…' : 'Requesting download…'}</p>
        )}
        {message && (
          <p role={failed ? 'alert' : 'status'} className="text-sm">
            {message}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Retry with either download button. For complete JSON, close this dialog and use the
          toolbar JSON or local recovery download.
        </p>
      </DialogContent>
    </Dialog>
  );
}
