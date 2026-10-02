import { useState } from 'react';
import type { GraphProjection } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SelectionReference } from '@/features/editor/state';
import { navigableObjects, toggleObjectSelection } from './object-navigation';

interface ObjectNavigationPanelProps {
  readonly projection: GraphProjection;
  readonly selection: readonly SelectionReference[];
  readonly setSelection: (references: readonly SelectionReference[]) => void;
}
const OBJECT_PAGE_SIZE = 50;

export function ObjectNavigationPanel({
  projection,
  selection,
  setSelection,
}: ObjectNavigationPanelProps) {
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(OBJECT_PAGE_SIZE);
  const objects = navigableObjects(projection).filter(({ label }) =>
    label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <Collapsible className="grid gap-3 border-b p-4">
      <CollapsibleTrigger asChild>
        <Button id="browse-objects" type="button" variant="outline">
          Browse objects
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3">
        <p className="text-xs text-muted-foreground">
          Select one object to inspect its fields below. Toggle several cards or boundaries for
          group movement and alignment. Selection also supplies discussion anchors and step
          highlights.
        </p>
        <Label htmlFor="object-filter">Find cards, boundaries or connections</Label>
        <Input
          id="object-filter"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(OBJECT_PAGE_SIZE);
          }}
        />
        <p className="text-xs" role="status">
          {objects.length} matching objects; {selection.length} selected.
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={selection.length === 0}
          onClick={() => setSelection([])}
        >
          Clear object selection
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={selection.length === 0}
          onClick={() => document.getElementById('selected-object-properties')?.focus()}
        >
          Go to selected properties
        </Button>
        <ul className="grid max-h-60 gap-2 overflow-y-auto" aria-label="Board objects">
          {objects.slice(0, visibleCount).map(({ reference, label }) => {
            const selected = selection.some(
              ({ id, kind }) => id === reference.id && kind === reference.kind,
            );
            return (
              <li
                key={`${reference.kind}:${reference.id}`}
                className="grid gap-1 rounded-lg border p-2"
              >
                <p className="break-words text-xs">{label}</p>
                <div className="flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Select only ${label}`}
                    onClick={() => {
                      setSelection([reference]);
                      requestAnimationFrame(() =>
                        document.getElementById('selected-object-properties')?.focus(),
                      );
                    }}
                  >
                    Select only
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={selected}
                    aria-label={`Toggle selection of ${label}`}
                    onClick={() => setSelection(toggleObjectSelection(selection, reference))}
                  >
                    {selected ? 'Selected' : 'Add to selection'}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        {visibleCount < objects.length && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setVisibleCount((count) => count + OBJECT_PAGE_SIZE)}
          >
            Show more objects
          </Button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
