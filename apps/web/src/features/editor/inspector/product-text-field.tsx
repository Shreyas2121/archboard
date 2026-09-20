import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import type { GraphTextTarget } from '@archboard/document-model';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { EditorSession } from '@/features/editor/application';
import { cn } from '@/lib/utils';

interface TextChange {
  readonly index: number;
  readonly deleteCount: number;
  readonly insert: string;
}

export function minimalTextChange(previous: string, next: string): TextChange {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }

  return {
    index: prefix,
    deleteCount: previous.length - prefix - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

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
  const rendered = useRef(value);
  const latestValue = useRef(value);
  latestValue.current = value;
  const invalidDraft = useRef(false);
  const composing = useRef(false);
  const [draftLength, setDraftLength] = useState(value.length);
  const [error, setError] = useState<string | null>(null);
  const targetKey = `${target.entity}:${target.id}:${target.field}`;
  const access = useMemo(() => session.accessText(target), [session, targetKey]);
  const inputId = `inspector-${targetKey.replaceAll(':', '-')}`;

  useEffect(() => {
    const element = control.current;
    if (element === null) return;
    const initialValue = access?.value ?? latestValue.current;
    element.value = initialValue;
    rendered.current = initialValue;
    invalidDraft.current = false;
    setDraftLength(initialValue.length);
    setError(null);
    if (access === null) return;

    return access.subscribe(() => {
      const next = access.value;
      rendered.current = next;
      if (!invalidDraft.current && !composing.current) {
        updateControlValue(element, next);
        setDraftLength(next.length);
      }
    });
  }, [access, targetKey]);

  useEffect(() => {
    const element = control.current;
    if (access !== null || element === null || invalidDraft.current || composing.current) return;
    updateControlValue(element, value);
    rendered.current = value;
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
    const change = minimalTextChange(rendered.current, next);
    if (change.deleteCount === 0 && change.insert.length === 0) {
      invalidDraft.current = false;
      setError(null);
      return;
    }
    try {
      session.editText(target, change);
      rendered.current = next;
      invalidDraft.current = false;
      setError(null);
    } catch {
      invalidDraft.current = true;
      setError('This value could not be saved. Correct it or press Escape to cancel.');
    }
  };

  const cancelDraft = (): void => {
    const element = control.current;
    if (element === null) return;
    const committed = access?.value ?? rendered.current;
    updateControlValue(element, committed);
    rendered.current = committed;
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
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={inputId}>{label}</Label>
        <span
          className={cn(
            'text-[0.65rem] tabular-nums text-muted-foreground',
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
