import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { GraphTextTarget } from '@archboard/document-model';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { EditorSession } from '@/features/editor/application';
import { cn } from '@/lib/utils';

import { minimalTextChange, TextDraft } from './text-draft';

function updateControlValue(control: HTMLInputElement | HTMLTextAreaElement, next: string): void {
  if (control.value === next) return;
  const change = minimalTextChange(control.value, next);
  const focused = document.activeElement === control;
  const start = control.selectionStart;
  const end = control.selectionEnd;
  const direction = control.selectionDirection;
  control.setRangeText(change.insert, change.index, change.index + change.deleteCount, 'preserve');
  if (focused && start !== null && end !== null) {
    const delta = change.insert.length - change.deleteCount;
    const map = (position: number): number => {
      if (position <= change.index) return position;
      if (position <= change.index + change.deleteCount) return change.index + change.insert.length;
      return position + delta;
    };
    control.setSelectionRange(map(start), map(end), direction ?? undefined);
  }
}

interface ProductTextFieldProps {
  readonly session: EditorSession;
  readonly target: GraphTextTarget;
  readonly label: string;
  readonly value: string;
  readonly limit: number;
  readonly disabled: boolean;
  readonly multiline?: boolean;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly monospace?: boolean;
}

const DEFAULT_TEXTAREA_ROWS = 4;

export function ProductTextField({
  session,
  target,
  label,
  value,
  limit,
  disabled,
  multiline = false,
  rows = DEFAULT_TEXTAREA_ROWS,
  placeholder,
  monospace = false,
}: ProductTextFieldProps) {
  const control = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const draft = useRef(new TextDraft(value));
  const committing = useRef(false);
  const latestValue = useRef(value);
  latestValue.current = value;
  const invalidDraft = useRef(false);
  const composing = useRef(false);
  const [draftLength, setDraftLength] = useState(value.length);
  const [error, setError] = useState<string | null>(null);
  const targetKey = `${target.entity}:${target.id}:${target.field}`;
  const bindingGeneration = useSyncExternalStore(
    session.subscribe,
    session.getTextBindingGeneration,
    session.getTextBindingGeneration,
  );
  const targetRef = useRef(target);
  if (
    targetRef.current.entity !== target.entity ||
    targetRef.current.id !== target.id ||
    targetRef.current.field !== target.field
  )
    targetRef.current = target;
  const stableTarget = targetRef.current;
  const access = useMemo(() => {
    if (bindingGeneration !== session.getTextBindingGeneration()) return null;
    return session.accessText(stableTarget);
  }, [session, stableTarget, bindingGeneration]);
  const inputId = `inspector-${targetKey.replaceAll(':', '-')}`;

  useEffect(() => {
    const element = control.current;
    if (element === null) return;
    const initialValue = access?.value ?? latestValue.current;
    element.value = initialValue;
    draft.current = new TextDraft(initialValue);
    composing.current = false;
    invalidDraft.current = false;
    setDraftLength(initialValue.length);
    setError(null);
    if (access === null) return;

    const unsubscribe = access.subscribe((delta) => {
      if (committing.current) return;
      const next = access.value;
      draft.current.receive(delta);
      if (!invalidDraft.current && !composing.current) {
        updateControlValue(element, next);
        draft.current = new TextDraft(next);
        setDraftLength(next.length);
      }
    });
    return () => {
      unsubscribe();
      composing.current = false;
      session.finishTextHistory();
    };
  }, [access, targetKey, session]);

  useEffect(() => {
    const element = control.current;
    if (access !== null || element === null || invalidDraft.current || composing.current) return;
    updateControlValue(element, value);
    draft.current = new TextDraft(value);
    setDraftLength(value.length);
  }, [access, value]);

  const commitControl = (): void => {
    const element = control.current;
    if (element === null || access === null) return;
    const next = element.value;
    setDraftLength(next.length);
    if (next.length > limit) {
      invalidDraft.current = true;
      setError(`Limit exceeded by ${next.length - limit} characters.`);
      return;
    }
    const changes = draft.current.edits(next);
    try {
      committing.current = true;
      if (changes.length > 0) session.editText(target, changes);
      const committed = access.value;
      updateControlValue(element, committed);
      draft.current = new TextDraft(committed);
      setDraftLength(committed.length);
      invalidDraft.current = false;
      setError(null);
    } catch {
      invalidDraft.current = true;
      setError('This value could not be saved. Correct it or press Escape to cancel.');
    } finally {
      committing.current = false;
    }
  };

  const cancelDraft = (): void => {
    const element = control.current;
    if (element === null) return;
    const committed = access?.value ?? latestValue.current;
    updateControlValue(element, committed);
    draft.current = new TextDraft(committed);
    invalidDraft.current = false;
    setDraftLength(committed.length);
    setError(null);
    session.finishTextHistory();
  };

  const handleInput = (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    setDraftLength(event.currentTarget.value.length);
    if (!composing.current) commitControl();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelDraft();
      return;
    }
    if (event.key === 'Enter' && (!multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commitControl();
      event.currentTarget.blur();
    }
  };
  const commonProps = {
    id: inputId,
    defaultValue: value,
    disabled: disabled || access === null,
    placeholder,
    'aria-invalid': error !== null,
    'aria-describedby': `${inputId}-help${error === null ? '' : ` ${inputId}-error`}`,
    onInput: handleInput,
    onKeyDown: handleKeyDown,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
      commitControl();
    },
    onBlur: () => {
      if (invalidDraft.current) cancelDraft();
      session.finishTextHistory();
    },
  } as const;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={inputId}>{label}</Label>
        <span
          className={cn(
            'text-xs tabular-nums text-muted-foreground',
            draftLength > limit && 'text-destructive',
          )}
          id={`${inputId}-help`}
        >
          {limit - draftLength} remaining
        </span>
      </div>
      {multiline ? (
        <Textarea
          {...commonProps}
          ref={(element) => {
            control.current = element;
          }}
          className={cn('max-h-72 resize-y', monospace && 'font-mono text-xs')}
          rows={rows}
        />
      ) : (
        <Input
          {...commonProps}
          ref={(element) => {
            control.current = element;
          }}
        />
      )}
      {error !== null && (
        <p className="text-xs text-destructive" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
