import type { ColorToken } from '@archboard/contracts';

export const CARD_COLOR_RULES: Readonly<Record<ColorToken, string>> = {
  gray: 'bg-graph-gray',
  blue: 'bg-graph-blue',
  teal: 'bg-graph-teal',
  green: 'bg-graph-green',
  amber: 'bg-graph-amber',
  red: 'bg-graph-red',
  violet: 'bg-graph-violet',
};
