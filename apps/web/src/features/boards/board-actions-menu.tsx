import { useRef } from 'react';
import { Archive, Copy, MoreHorizontal, Pencil, RotateCcw } from 'lucide-react';
import { BOARD_ROLES } from '@archboard/contracts';
import type { BoardRole } from '@archboard/contracts';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { BoardAction } from './board-api';

interface BoardActionsMenuProps {
  readonly title: string;
  readonly role: BoardRole;
  readonly archived: boolean;
  readonly offline?: boolean;
  readonly onAction?: (action: BoardAction, trigger: HTMLButtonElement | null) => void;
}

export function BoardActionsMenu({
  title,
  role,
  archived,
  offline = false,
  onAction,
}: BoardActionsMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const canEdit = !archived && role !== BOARD_ROLES.VIEWER;
  const owner = role === BOARD_ROLES.OWNER;
  function selectAction(action: BoardAction) {
    if (offline || !onAction) return;
    openingDialog.current = true;
    onAction(action, trigger.current);
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Board actions for ${title}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-48"
        onCloseAutoFocus={(event) => {
          // Let the dialog take focus; its close handler returns to this persistent trigger.
          if (openingDialog.current) {
            event.preventDefault();
            openingDialog.current = false;
          }
        }}
      >
        <DropdownMenuLabel>Board actions</DropdownMenuLabel>
        {offline ? (
          <DropdownMenuLabel className="max-w-56 whitespace-normal font-normal">
            Reconnect to manage this board.
          </DropdownMenuLabel>
        ) : null}
        {canEdit ? (
          <DropdownMenuItem disabled={offline} onSelect={() => selectAction('edit')}>
            <Pencil /> Edit details
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={offline} onSelect={() => selectAction('duplicate')}>
          <Copy /> Duplicate board
        </DropdownMenuItem>
        {owner ? (
          <>
            <DropdownMenuSeparator />
            {archived ? (
              <DropdownMenuItem disabled={offline} onSelect={() => selectAction('restore')}>
                <RotateCcw /> Restore board
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={offline}
                variant="destructive"
                onSelect={() => selectAction('archive')}
              >
                <Archive /> Archive board
              </DropdownMenuItem>
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
