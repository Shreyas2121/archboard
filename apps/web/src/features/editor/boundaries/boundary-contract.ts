import { COLOR_TOKENS, boundarySchema, type Boundary, type Point } from '@archboard/contracts';

export const DEFAULT_BOUNDARY_SIZE = { width: 480, height: 320 } as const;

export function createBoundaryObject(id: string, position: Point): Boundary {
  return boundarySchema.parse({
    id,
    title: 'Boundary',
    rect: { ...position, ...DEFAULT_BOUNDARY_SIZE },
    color: COLOR_TOKENS.GRAY,
  });
}
