import { NODE_KINDS, type NodeKind } from '@archboard/contracts';
import { Box, Braces, Code2, Database, StickyNote, type LucideIcon } from 'lucide-react';
interface PaletteItem {
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly kind: NodeKind | 'boundary';
}

export const PALETTE_ITEMS: readonly PaletteItem[] = [
  {
    label: 'Component',
    description: 'Service or application',
    icon: Box,
    kind: NODE_KINDS.COMPONENT,
  },
  { label: 'Code', description: 'Module or repository', icon: Code2, kind: NODE_KINDS.CODE },
  {
    label: 'Schema',
    description: 'Data contract or store',
    icon: Database,
    kind: NODE_KINDS.SCHEMA,
  },
  { label: 'Note', description: 'Context for the team', icon: StickyNote, kind: NODE_KINDS.NOTE },
  { label: 'Boundary', description: 'Visual grouping region', icon: Braces, kind: 'boundary' },
];
