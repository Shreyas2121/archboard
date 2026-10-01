import { useState } from 'react';
import {
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_STEP_NOTES_CHARACTERS,
  MAX_STEP_TITLE_CHARACTERS,
  type GraphProjection,
  type PresentationStep,
} from '@archboard/contracts';
import type { EditorSession } from '@/features/editor/application';
import { ProductTextField } from '@/features/editor/inspector/product-text-field';
import { Button } from '@/components/ui/button';
import { newStepOrder, reorderedSteps, sortedSteps } from './presentation-model';

interface StepsPanelProps {
  session: EditorSession;
  projection: GraphProjection;
  editable: boolean;
  capture: () => Pick<PresentationStep, 'rect' | 'nodeIds' | 'edgeIds'>;
  highlights: () => Pick<PresentationStep, 'nodeIds' | 'edgeIds'>;
  present: (id: string) => void;
}
export function StepsPanel({
  session,
  projection,
  editable,
  capture,
  highlights,
  present,
}: StepsPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const steps = sortedSteps(projection.steps);
  const selected = steps.find(({ id }) => id === selectedId) ?? null;
  const run = (action: () => void) => {
    try {
      action();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The step could not be changed.');
    }
  };
  const reorder = (sourceId: string, targetId: string) =>
    run(() => session.reorderSteps(reorderedSteps(steps, sourceId, targetId)));
  return (
    <section className="grid gap-4 p-4" aria-label="Presentation steps">
      <p className="text-xs text-muted-foreground">
        Capture the visible canvas and selected cards or connections. Presentation plays locally,
        including available offline steps.
      </p>
      <Button
        type="button"
        disabled={!editable || steps.length >= MAX_LIVE_PRESENTATION_STEPS}
        onClick={() =>
          run(() => {
            const id = crypto.randomUUID();
            session.createStep({
              id,
              title: `Step ${steps.length + 1}`,
              notes: '',
              order: newStepOrder(steps),
              ...capture(),
            });
            setSelectedId(id);
          })
        }
      >
        Capture new step
      </Button>
      {!editable && (
        <p className="text-xs text-muted-foreground">
          Step authoring is unavailable in this view. Existing steps can still be presented.
        </p>
      )}
      {steps.length >= MAX_LIVE_PRESENTATION_STEPS && (
        <p className="text-xs text-muted-foreground">The board has reached its 50-step limit.</p>
      )}
      {steps.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          No presentation steps yet.
        </p>
      )}
      <ol className="grid gap-2">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="grid gap-2 rounded-lg border p-2"
            draggable={editable}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', step.id);
              setDraggedId(step.id);
            }}
            onDragEnd={() => setDraggedId(null)}
            onDragOver={(event) => {
              if (editable && draggedId !== null) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (editable && draggedId !== null) reorder(draggedId, step.id);
              setDraggedId(null);
            }}
          >
            <Button
              type="button"
              variant={selectedId === step.id ? 'outline' : 'ghost'}
              className="h-auto justify-start whitespace-normal text-left break-words"
              aria-pressed={selectedId === step.id}
              onClick={() => setSelectedId(step.id)}
            >
              {index + 1}. {step.title || 'Untitled step'}
            </Button>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => present(step.id)}
                aria-label={`Present ${step.title || 'untitled step'}`}
              >
                Present
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!editable || index === 0}
                onClick={() => {
                  const previous = steps[index - 1];
                  if (previous) reorder(step.id, previous.id);
                }}
                aria-label={`Move ${step.title || 'untitled step'} earlier`}
              >
                Earlier
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!editable || index === steps.length - 1}
                onClick={() => {
                  const next = steps[index + 1];
                  if (next) reorder(step.id, next.id);
                }}
                aria-label={`Move ${step.title || 'untitled step'} later`}
              >
                Later
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {selected && (
        <div className="grid gap-4" key={selected.id}>
          <ProductTextField
            session={session}
            target={{ entity: 'step', id: selected.id, field: 'title' }}
            label="Step title"
            value={selected.title}
            limit={MAX_STEP_TITLE_CHARACTERS}
            disabled={!editable}
          />
          <ProductTextField
            session={session}
            target={{ entity: 'step', id: selected.id, field: 'notes' }}
            label="Step notes"
            value={selected.notes}
            limit={MAX_STEP_NOTES_CHARACTERS}
            disabled={!editable}
            multiline
          />
          <p className="text-xs text-muted-foreground">
            {selected.nodeIds.length} cards and {selected.edgeIds.length} connections highlighted.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!editable}
            onClick={() => run(() => session.editStep(selected.id, { rect: capture().rect }))}
          >
            Recapture visible rectangle
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!editable}
            onClick={() =>
              run(() => {
                const selectedHighlights = highlights();
                session.editStep(selected.id, {
                  nodeIds: selectedHighlights.nodeIds,
                  edgeIds: selectedHighlights.edgeIds,
                });
              })
            }
          >
            Replace highlights with selection
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!editable}
            onClick={() =>
              run(() => {
                session.deleteStep(selected.id);
                setSelectedId(null);
              })
            }
          >
            Delete step
          </Button>
        </div>
      )}
      {selectedId !== null && selected === null && (
        <p role="status" className="text-sm text-muted-foreground">
          The selected step was deleted. Choose a remaining step.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
