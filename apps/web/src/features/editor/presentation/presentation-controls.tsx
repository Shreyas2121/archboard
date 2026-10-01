import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import type { useLocalPresentation } from './use-local-presentation';
import { adjacentStep } from './presentation-model';

export function PresentationControls({
  playback,
}: {
  playback: ReturnType<typeof useLocalPresentation>;
}) {
  const exitButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    exitButton.current?.focus();
  }, []);
  const index = playback.ordered.findIndex(({ id }) => id === playback.activeId);
  return (
    <header
      className="flex min-w-0 items-center gap-2 border-b bg-surface-panel px-3"
      aria-label="Local presentation controls"
    >
      <span className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
        {playback.step?.title || (playback.step ? 'Untitled step' : 'Step unavailable')} ·{' '}
        {index < 0 ? 0 : index + 1}/{playback.ordered.length}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          playback.activeId === null ||
          adjacentStep(playback.ordered, playback.activeId, -1) === null
        }
        onClick={() => playback.navigate(-1)}
        aria-label="Previous presentation step"
      >
        Previous
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={
          playback.activeId === null ||
          adjacentStep(playback.ordered, playback.activeId, 1) === null
        }
        onClick={() => playback.navigate(1)}
        aria-label="Next presentation step"
      >
        Next
      </Button>
      <Button type="button" size="sm" ref={exitButton} onClick={playback.exit}>
        Exit presentation
      </Button>
    </header>
  );
}
export function PresentationNotes({
  playback,
}: {
  playback: ReturnType<typeof useLocalPresentation>;
}) {
  return (
    <aside
      className="grid max-h-48 shrink-0 gap-2 overflow-y-auto border-b bg-surface-panel p-3"
      aria-label="Presentation notes"
    >
      {playback.step ? (
        <p className="whitespace-pre-wrap break-words text-sm">
          {playback.step.notes || 'No notes for this step.'}
        </p>
      ) : (
        <>
          <p role="status">
            {playback.ordered.length
              ? 'This step was deleted. Choose a remaining step or exit.'
              : 'No presentation steps remain. Exit to return to the board.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {playback.ordered.map((step) => (
              <Button
                type="button"
                variant="outline"
                key={step.id}
                onClick={() => playback.choose(step.id)}
              >
                {step.title || 'Untitled step'}
              </Button>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
