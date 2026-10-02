import { listBoards } from '@/features/boards/board-api';
import type { PortabilityScope } from './use-portability-scope';

export async function inspectVisibleBoards(scope: PortabilityScope): Promise<string[]> {
  const token = scope.capture();
  const rows: string[] = [];
  for (const archived of [false, true]) {
    let cursor: string | null = null;
    do {
      if (!scope.accepts(token)) throw new Error('Access changed during results review.');
      const page = await listBoards('', archived, cursor, new AbortController().signal);
      if (!scope.accepts(token)) throw new Error('Access changed during results review.');
      rows.push(...page.data.map((board) => `${board.title} (${board.id})`));
      cursor = page.nextCursor;
    } while (cursor);
  }
  return rows;
}
