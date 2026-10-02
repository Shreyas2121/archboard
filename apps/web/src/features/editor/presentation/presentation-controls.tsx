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
      className="flex min-h-14 min-w-0 flex-wrap items-center gap-2 border-b bg-surface-panel px-3 py-2"
      aria-label="Presentation controls"
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
          playback.following ||
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
          playback.following ||
          playback.activeId === null ||
          adjacentStep(playback.ordered, playback.activeId, 1) === null
        }
        onClick={() => playback.navigate(1)}
        aria-label="Next presentation step"
      >
        Next
      </Button>
      <Button
        id="exit-presentation"
        type="button"
        size="sm"
        ref={exitButton}
        onClick={playback.exit}
      >
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
      {playback.waiting ? (
        <p role="status">{playback.waiting}</p>
      ) : playback.step ? (
        <p className="whitespace-pre-wrap break-words text-sm">
          {playback.step.notes || 'No notes for this step.'}
        </p>
      ) : (
        <>
          <p role="status">
            {playback.ordered.length
              ? playback.activeId === null
                ? 'Choose a presentation step or exit.'
                : 'This step was deleted. Choose a remaining step or exit.'
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

export function PresenterControls({
  playback,
}: {
  playback: ReturnType<typeof useLocalPresentation>;
}) {
  return (
    <section
      className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-surface-panel px-3 py-2"
      aria-label="Live presentation controls"
      data-following={playback.following}
    >
      <p className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">
        {!playback.live
          ? 'Live presenting is unavailable. Local playback remains available.'
          : playback.ownsLease
            ? 'You are presenting live.'
            : playback.following
              ? 'Following presenter. Pan or Unfollow for local control.'
              : playback.holder
                ? 'Presenter available. Following is optional.'
                : 'No active presenter.'}
      </p>
      {playback.live && playback.eligible && !playback.holder && (
        <Button type="button" variant="outline" size="sm" onClick={playback.acquire}>
          Acquire presenter
        </Button>
      )}
      {playback.live && playback.ownsLease && (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={playback.broadcast}
            disabled={!playback.canBroadcast || playback.step === null}
          >
            Broadcast current step
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={playback.release}>
            Release presenter
          </Button>
        </>
      )}
      {playback.live && playback.holder && !playback.ownsLease && !playback.following && (
        <Button type="button" variant="outline" size="sm" onClick={playback.follow}>
          Follow presenter
        </Button>
      )}
      {playback.following && (
        <Button type="button" variant="outline" size="sm" onClick={playback.unfollow}>
          Unfollow
        </Button>
      )}
      {playback.ownsLease && !playback.canBroadcast && (
        <p className="w-full text-xs text-muted-foreground">
          Live step broadcast requires editing access and synchronized local changes.
        </p>
      )}
      {playback.notice && (
        <p className="w-full text-xs text-destructive" role="alert">
          {playback.notice}
        </p>
      )}
    </section>
  );
}
