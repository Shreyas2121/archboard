import { useState } from 'react';
import { HANDLES, type GraphNode, type Handle } from '@archboard/contracts';
import { Cable } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import type { ConnectionEndpoints } from './connection-contract';

const MINIMUM_CONNECTION_NODES = 2;

interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface ConnectionSelectProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly SelectOption[];
  readonly onChange: (value: string) => void;
}

function ConnectionSelect({ id, label, value, options, onChange }: ConnectionSelectProps) {
  return (
    <div className="grid gap-1.5" onKeyDown={(event) => event.stopPropagation()}>
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem value={option.value} key={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface KeyboardConnectionFlowProps {
  readonly nodes: readonly GraphNode[];
  readonly initialSourceId: string;
  readonly disabled: boolean;
  readonly onCreate: (endpoints: ConnectionEndpoints) => string | null;
}

export function KeyboardConnectionFlow({
  nodes,
  initialSourceId,
  disabled,
  onCreate,
}: KeyboardConnectionFlowProps) {
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [sourceHandle, setSourceHandle] = useState<Handle>(HANDLES.RIGHT);
  const [targetId, setTargetId] = useState(
    nodes.find(({ id }) => id !== initialSourceId)?.id ?? initialSourceId,
  );
  const [targetHandle, setTargetHandle] = useState<Handle>(HANDLES.LEFT);
  const [error, setError] = useState<string | null>(null);
  const nodeOptions = nodes.map((node) => ({
    value: node.id,
    label: `${node.title || 'Untitled card'} (${node.kind})`,
  }));
  const handleOptions = Object.values(HANDLES).map((handle) => ({ value: handle, label: handle }));
  const nodeName = (id: string): string =>
    nodes.find((node) => node.id === id)?.title || 'Untitled card';

  const begin = (): void => {
    setSourceId(initialSourceId);
    setTargetId(nodes.find(({ id }) => id !== initialSourceId)?.id ?? initialSourceId);
    setSourceHandle(HANDLES.RIGHT);
    setTargetHandle(HANDLES.LEFT);
    setReviewing(false);
    setError(null);
    setOpen(true);
  };
  const review = (): void => {
    if (sourceId === targetId) {
      setError('A card cannot connect to itself. Choose a different target card.');
      return;
    }
    setError(null);
    setReviewing(true);
  };
  const create = (): void => {
    const nextError = onCreate({ sourceId, sourceHandle, targetId, targetHandle });
    if (nextError !== null) {
      setError(nextError);
      return;
    }
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          className="w-full"
          variant="outline"
          disabled={disabled || nodes.length < MINIMUM_CONNECTION_NODES}
          onClick={begin}
        >
          <Cable /> Connect cards
        </Button>
      </DialogTrigger>
      <p className="mt-2 text-[0.65rem] leading-4 text-muted-foreground">
        {nodes.length < MINIMUM_CONNECTION_NODES
          ? 'Create another card to enable keyboard connection.'
          : 'Keyboard flow: choose endpoints, review, then create.'}
      </p>
      <DialogContent onKeyDown={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{reviewing ? 'Review connection' : 'Connect cards'}</DialogTitle>
          <DialogDescription>
            {reviewing
              ? 'Confirm the immutable endpoints and handles before creating.'
              : 'Choose one of the four fixed handles on two different cards.'}
          </DialogDescription>
        </DialogHeader>
        {reviewing ? (
          <dl className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div>
              <dt className="text-xs text-muted-foreground">Source</dt>
              <dd className="font-medium">
                {nodeName(sourceId)} · {sourceHandle}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Target</dt>
              <dd className="font-medium">
                {nodeName(targetId)} · {targetHandle}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Defaults</dt>
              <dd className="font-medium">Forward · solid · empty label and protocol</dd>
            </div>
          </dl>
        ) : (
          <div className="grid gap-4">
            <ConnectionSelect
              id="connection-source-card"
              label="Source card"
              value={sourceId}
              options={nodeOptions}
              onChange={setSourceId}
            />
            <ConnectionSelect
              id="connection-source-handle"
              label="Source handle"
              value={sourceHandle}
              options={handleOptions}
              onChange={(value) => setSourceHandle(value as Handle)}
            />
            <ConnectionSelect
              id="connection-target-card"
              label="Target card"
              value={targetId}
              options={nodeOptions}
              onChange={setTargetId}
            />
            <ConnectionSelect
              id="connection-target-handle"
              label="Target handle"
              value={targetHandle}
              options={handleOptions}
              onChange={(value) => setTargetHandle(value as Handle)}
            />
          </div>
        )}
        {error !== null && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {reviewing ? (
            <>
              <Button type="button" variant="outline" onClick={() => setReviewing(false)}>
                Back
              </Button>
              <Button type="button" onClick={create}>
                Create connection
              </Button>
            </>
          ) : (
            <Button type="button" onClick={review}>
              Review connection
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
