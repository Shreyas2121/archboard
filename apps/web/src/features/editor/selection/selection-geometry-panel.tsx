import { useEffect, useMemo, useState } from 'react';
import type { GraphProjection } from '@archboard/contracts';
import { NODE_ALIGNMENTS, type GeometryBatch, type NodeAlignment } from '@archboard/document-model';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { EditorSession } from '@/features/editor/application';
import { SELECTION_KINDS, type SelectionReference } from '@/features/editor/state';

const ALIGNMENTS: readonly { readonly value: NodeAlignment; readonly label: string }[] = [
  { value: NODE_ALIGNMENTS.LEFT, label: 'Left' },
  { value: NODE_ALIGNMENTS.HORIZONTAL_CENTER, label: 'Horizontal center' },
  { value: NODE_ALIGNMENTS.RIGHT, label: 'Right' },
  { value: NODE_ALIGNMENTS.TOP, label: 'Top' },
  { value: NODE_ALIGNMENTS.VERTICAL_CENTER, label: 'Vertical center' },
  { value: NODE_ALIGNMENTS.BOTTOM, label: 'Bottom' },
];
const MINIMUM_ALIGNMENT_NODES = 2;

interface GeometryValues {
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
}

const numberValue = (value: string): number => Number(value);

interface SelectionGeometryPanelProps {
  readonly projection: GraphProjection;
  readonly selection: readonly SelectionReference[];
  readonly session: EditorSession;
  readonly disabled: boolean;
  readonly onNotice: (message: string) => void;
}

export function SelectionGeometryPanel({
  projection,
  selection,
  session,
  disabled,
  onNotice,
}: SelectionGeometryPanelProps) {
  const selectedNodes = projection.nodes.filter((node) =>
    selection.some(({ id, kind }) => id === node.id && kind === SELECTION_KINDS.NODE),
  );
  const selectedBoundaries = projection.boundaries.filter((boundary) =>
    selection.some(({ id, kind }) => id === boundary.id && kind === SELECTION_KINDS.BOUNDARY),
  );
  const singleNode =
    selectedNodes.length === 1 && selectedBoundaries.length === 0 ? selectedNodes[0] : null;
  const singleBoundary =
    selectedBoundaries.length === 1 && selectedNodes.length === 0 ? selectedBoundaries[0] : null;
  const x = singleNode?.position.x ?? singleBoundary?.rect.x;
  const y = singleNode?.position.y ?? singleBoundary?.rect.y;
  const width = singleNode?.size.width ?? singleBoundary?.rect.width;
  const height = singleNode?.size.height ?? singleBoundary?.rect.height;
  const singleRect = useMemo(
    () =>
      x === undefined || y === undefined || width === undefined || height === undefined
        ? null
        : { x, y, width, height },
    [x, y, width, height],
  );
  const [values, setValues] = useState<GeometryValues>({ x: '', y: '', width: '', height: '' });
  const [deltaX, setDeltaX] = useState('0');
  const [deltaY, setDeltaY] = useState('0');

  useEffect(() => {
    if (singleRect === null) return;
    setValues({
      x: String(singleRect.x),
      y: String(singleRect.y),
      width: String(singleRect.width),
      height: String(singleRect.height),
    });
  }, [singleBoundary?.id, singleNode?.id, singleRect]);

  const updateValue = (field: keyof GeometryValues, value: string): void =>
    setValues((current) => ({ ...current, [field]: value }));
  const applySingle = (): void => {
    const rect = {
      x: numberValue(values.x),
      y: numberValue(values.y),
      width: numberValue(values.width),
      height: numberValue(values.height),
    };
    try {
      const batch: GeometryBatch = singleNode
        ? {
            nodes: [
              {
                id: singleNode.id,
                position: { x: rect.x, y: rect.y },
                size: { width: rect.width, height: rect.height },
              },
            ],
          }
        : singleBoundary
          ? { boundaries: [{ id: singleBoundary.id, rect }] }
          : {};
      session.setGeometry(batch);
      onNotice('Geometry updated.');
    } catch {
      onNotice('Enter geometry within the shared coordinate and size limits.');
    }
  };
  const moveSelection = (): void => {
    const x = numberValue(deltaX);
    const y = numberValue(deltaY);
    try {
      session.setGeometry({
        nodes: selectedNodes.map((node) => ({
          id: node.id,
          position: { x: node.position.x + x, y: node.position.y + y },
        })),
        boundaries: selectedBoundaries.map((boundary) => ({
          id: boundary.id,
          rect: { ...boundary.rect, x: boundary.rect.x + x, y: boundary.rect.y + y },
        })),
      });
      onNotice('Selection moved in one update.');
    } catch {
      onNotice('The movement exceeds the shared coordinate limits.');
    }
  };
  const align = (alignment: NodeAlignment): void => {
    try {
      session.alignCards(
        selectedNodes.map(({ id }) => id),
        alignment,
      );
      onNotice('Cards aligned in one update.');
    } catch {
      onNotice('The selected cards could not be aligned.');
    }
  };

  return (
    <section className="grid gap-4 border-t p-4" aria-label="Selection geometry">
      <div>
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {selection.length} selected
        </p>
        <h3 className="mt-1 text-xs font-semibold">Geometry</h3>
        <p className="mt-1 text-[0.65rem] leading-4 text-muted-foreground">
          Values are absolute world coordinates. Pointer gestures snap to the 16-unit grid; hold Alt
          to bypass snapping.
        </p>
      </div>
      {singleRect !== null ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(['x', 'y', 'width', 'height'] as const).map((field) => (
              <div className="grid gap-1.5" key={field}>
                <Label htmlFor={`geometry-${field}`}>{field.toUpperCase()}</Label>
                <Input
                  id={`geometry-${field}`}
                  type="number"
                  value={values[field]}
                  disabled={disabled}
                  onChange={(event) => updateValue(field, event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
            ))}
          </div>
          <Button type="button" size="sm" disabled={disabled} onClick={applySingle}>
            Apply geometry
          </Button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="selection-delta-x">Move X</Label>
              <Input
                id="selection-delta-x"
                type="number"
                value={deltaX}
                disabled={disabled}
                onChange={(event) => setDeltaX(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="selection-delta-y">Move Y</Label>
              <Input
                id="selection-delta-y"
                type="number"
                value={deltaY}
                disabled={disabled}
                onChange={(event) => setDeltaY(event.target.value)}
              />
            </div>
          </div>
          <Button type="button" size="sm" disabled={disabled} onClick={moveSelection}>
            Move selection
          </Button>
        </>
      )}
      {selectedNodes.length >= MINIMUM_ALIGNMENT_NODES && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold">Align selected cards</p>
          <div className="grid grid-cols-2 gap-2">
            {ALIGNMENTS.map(({ value, label }) => (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                key={value}
                onClick={() => align(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
