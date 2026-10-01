import { LoaderCircle, UserRoundMinus } from 'lucide-react';
import type { BoardMember, ChangeMemberRole } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  canManageMember,
  SHARING_ROLE_LABELS,
  type SharingAuthority,
} from './board-sharing-policy';

interface BoardMemberListProps {
  readonly members: readonly BoardMember[];
  readonly authority: SharingAuthority;
  readonly busyMember: string | null;
  readonly blocked: boolean;
  readonly onRole: (userId: string, role: ChangeMemberRole['role']) => void;
  readonly onRemove: (member: BoardMember) => void;
}

export function BoardMemberList({
  members,
  authority,
  busyMember,
  blocked,
  onRole,
  onRemove,
}: BoardMemberListProps) {
  return (
    <ul className="divide-y rounded-lg border" aria-label="Board members">
      {members.map((member) => {
        const self = member.user.id === authority.accountId;
        const owner = member.user.id === authority.ownerId;
        const role = owner ? 'owner' : member.role;
        const manages =
          authority.role === 'owner' && authority.accountId === authority.ownerId && !owner;
        const pending = busyMember === member.user.id;
        return (
          <li key={member.user.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
            <div className="min-w-0 flex-1 basis-32">
              <p className="break-words text-sm font-medium">
                {member.user.name}
                {self && ' (you)'}
              </p>
              <p className="text-xs text-muted-foreground">
                {SHARING_ROLE_LABELS[role]}
                {owner && ' · immutable'}
              </p>
            </div>
            {manages && (
              <div className="flex items-center gap-2">
                <Select
                  value={member.role}
                  disabled={blocked || !canManageMember(authority, member.user.id)}
                  onValueChange={(value) => {
                    if ((value === 'editor' || value === 'viewer') && value !== member.role)
                      onRole(member.user.id, value);
                  }}
                >
                  <SelectTrigger
                    className="w-28"
                    size="sm"
                    aria-label={`Role for ${member.user.name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Viewer</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked || !canManageMember(authority, member.user.id)}
                  aria-label={`Remove ${member.user.name} from this board`}
                  onClick={() => onRemove(member)}
                >
                  {pending ? (
                    <LoaderCircle
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <UserRoundMinus aria-hidden="true" />
                  )}
                  Remove
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
