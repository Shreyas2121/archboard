import { useEffect, useId, useState } from 'react';
import {
  CODE_LANGUAGES,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  MAX_COMPONENT_DESCRIPTION_CHARACTERS,
  MAX_CONTENT_BODY_CHARACTERS,
  MAX_EXTERNAL_URL_CHARACTERS,
  MAX_NODE_TITLE_CHARACTERS,
  MAX_TECHNOLOGY_CHARACTERS,
  graphNodeSchema,
  type GraphNode,
} from '@archboard/contracts';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { EditorSession } from '@/features/editor/application';

import { ProductTextField } from './product-text-field';

const CATEGORY_OPTIONS = Object.values(COMPONENT_CATEGORIES);
const LANGUAGE_OPTIONS = Object.values(CODE_LANGUAGES);
const COLOR_OPTIONS = Object.values(COLOR_TOKENS);

interface AtomicSelectProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly Value[];
  readonly disabled: boolean;
  readonly onValueChange: (value: Value) => void;
}

function AtomicSelect<Value extends string>({
  label,
  value,
  options,
  disabled,
  onValueChange,
}: AtomicSelectProps<Value>) {
  const id = useId();
  return (
    <div className="grid gap-1.5" onKeyDown={(event) => event.stopPropagation()}>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => onValueChange(next as Value)}
        disabled={disabled}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem value={option} key={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface ExternalUrlFieldProps {
  readonly node: Extract<GraphNode, { kind: 'component' }>;
  readonly session: EditorSession;
  readonly disabled: boolean;
}

function ExternalUrlField({ node, session, disabled }: ExternalUrlFieldProps) {
  const id = `inspector-${node.id}-external-url`;
  const committed = node.content.externalUrl ?? '';
  const [draft, setDraft] = useState(committed);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setDraft(committed);
  }, [committed, dirty]);

  const cancel = (): void => {
    setDraft(committed);
    setDirty(false);
    setError(null);
  };
  const commit = (): void => {
    const externalUrl = draft.trim() || null;
    const candidate = {
      ...node,
      content: { ...node.content, externalUrl },
    };
    const result = graphNodeSchema.safeParse(candidate);
    if (!result.success) {
      setError(
        draft.length > MAX_EXTERNAL_URL_CHARACTERS
          ? `Limit exceeded by ${draft.length - MAX_EXTERNAL_URL_CHARACTERS} characters.`
          : 'Enter an HTTP or HTTPS URL.',
      );
      return;
    }
    try {
      session.setComponentExternalUrl(node.id, externalUrl);
      setDirty(false);
      setError(null);
    } catch {
      setError('This URL could not be saved.');
    }
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>External URL</Label>
        <span className="text-[0.65rem] tabular-nums text-muted-foreground">
          {MAX_EXTERNAL_URL_CHARACTERS - draft.length} remaining
        </span>
      </div>
      <Input
        id={id}
        inputMode="url"
        value={draft}
        disabled={disabled}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : `${id}-error`}
        placeholder="https://example.com"
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
      />
      {error !== null && (
        <p className="text-xs text-destructive" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface CardInspectorProps {
  readonly node: GraphNode;
  readonly session: EditorSession;
  readonly disabled: boolean;
}

export function CardInspector({ node, session, disabled }: CardInspectorProps) {
  const applyCandidate = (candidate: GraphNode, action: () => void): void => {
    if (!graphNodeSchema.safeParse(candidate).success) return;
    action();
  };

  return (
    <div className="grid content-start gap-5 p-4">
      <div>
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {node.kind} card
        </p>
        <p className="mt-1 truncate text-sm font-semibold">{node.title || 'Untitled card'}</p>
      </div>
      <ProductTextField
        session={session}
        target={{ entity: 'node', id: node.id, field: 'title' }}
        label="Title"
        value={node.title}
        limit={MAX_NODE_TITLE_CHARACTERS}
        disabled={disabled}
      />
      <AtomicSelect
        label="Color"
        value={node.color}
        options={COLOR_OPTIONS}
        disabled={disabled}
        onValueChange={(color) =>
          applyCandidate({ ...node, color }, () => session.setCardColor(node.id, color))
        }
      />
      {node.kind === 'component' && (
        <>
          <AtomicSelect
            label="Category"
            value={node.content.category}
            options={CATEGORY_OPTIONS}
            disabled={disabled}
            onValueChange={(category) =>
              applyCandidate({ ...node, content: { ...node.content, category } }, () =>
                session.setComponentCategory(node.id, category),
              )
            }
          />
          <ProductTextField
            session={session}
            target={{ entity: 'node', id: node.id, field: 'description' }}
            label="Description"
            value={node.content.description}
            limit={MAX_COMPONENT_DESCRIPTION_CHARACTERS}
            disabled={disabled}
            multiline
            rows={5}
          />
          <ProductTextField
            session={session}
            target={{ entity: 'node', id: node.id, field: 'technology' }}
            label="Technology"
            value={node.content.technology}
            limit={MAX_TECHNOLOGY_CHARACTERS}
            disabled={disabled}
          />
          <ExternalUrlField node={node} session={session} disabled={disabled} />
        </>
      )}
      {node.kind === 'code' && (
        <AtomicSelect
          label="Language"
          value={node.content.language}
          options={LANGUAGE_OPTIONS}
          disabled={disabled}
          onValueChange={(language) =>
            applyCandidate({ ...node, content: { ...node.content, language } }, () =>
              session.setCodeLanguage(node.id, language),
            )
          }
        />
      )}
      {node.kind !== 'component' && (
        <ProductTextField
          session={session}
          target={{ entity: 'node', id: node.id, field: 'body' }}
          label={node.kind === 'note' ? 'Note' : node.kind === 'schema' ? 'Schema' : 'Code'}
          value={node.content.body}
          limit={MAX_CONTENT_BODY_CHARACTERS}
          disabled={disabled}
          multiline
          monospace={node.kind !== 'note'}
          rows={10}
        />
      )}
      <p className="text-[0.65rem] leading-4 text-muted-foreground">
        Escape cancels an invalid draft. Enter finishes a single-line field; use Ctrl or Command +
        Enter for multiline fields.
      </p>
    </div>
  );
}
