import { ERROR_CODES } from '@archboard/contracts';

import {
  decideBoardPermission,
  type BoardAuthorityState,
  type BoardOperation,
} from './board-permissions.js';

const ACTOR = 'actor';
const ACTIVE: BoardAuthorityState = {
  id: 'board',
  ownerUserId: 'owner',
  memberRole: null,
  archivedAt: null,
  metadataVersion: 1,
  latestSeq: '0',
};
const OPERATIONS: BoardOperation[] = [
  'read',
  'editMetadata',
  'editGraph',
  'manageAccess',
  'manageLifecycle',
];

function authority(
  role: 'owner' | 'editor' | 'viewer' | 'none',
  archived: boolean,
): BoardAuthorityState {
  return {
    ...ACTIVE,
    ownerUserId: role === 'owner' ? ACTOR : 'owner',
    memberRole: role === 'editor' || role === 'viewer' ? role : null,
    archivedAt: archived ? new Date('2026-01-01T00:00:00.000Z') : null,
  };
}

describe('central board permission matrix', () => {
  it.each(OPERATIONS)('hides missing and unrelated boards for %s', (operation) => {
    expect(decideBoardPermission(operation, null, ACTOR)).toEqual({
      allowed: false,
      code: ERROR_CODES.NOT_FOUND,
    });
    expect(decideBoardPermission(operation, authority('none', false), ACTOR)).toEqual({
      allowed: false,
      code: ERROR_CODES.NOT_FOUND,
    });
  });

  it.each(['owner', 'editor', 'viewer'] as const)('permits active reads for %s', (role) => {
    expect(decideBoardPermission('read', authority(role, false), ACTOR)).toMatchObject({
      allowed: true,
      role,
    });
    expect(decideBoardPermission('read', authority(role, true), ACTOR)).toMatchObject({
      allowed: true,
      role,
    });
  });

  it.each(['editMetadata', 'editGraph'] as const)(
    '%s permits owner/editor, denies viewer, and blocks archived writes',
    (operation) => {
      for (const role of ['owner', 'editor'] as const) {
        expect(decideBoardPermission(operation, authority(role, false), ACTOR)).toMatchObject({
          allowed: true,
          role,
        });
        expect(decideBoardPermission(operation, authority(role, true), ACTOR)).toEqual({
          allowed: false,
          code: ERROR_CODES.BOARD_ARCHIVED,
        });
      }
      expect(decideBoardPermission(operation, authority('viewer', false), ACTOR)).toEqual({
        allowed: false,
        code: ERROR_CODES.FORBIDDEN,
      });
      expect(decideBoardPermission(operation, authority('viewer', true), ACTOR)).toEqual({
        allowed: false,
        code: ERROR_CODES.FORBIDDEN,
      });
    },
  );

  it('restricts access management to active owners and permits archived-owner lifecycle work', () => {
    expect(decideBoardPermission('manageAccess', authority('owner', false), ACTOR)).toMatchObject({
      allowed: true,
      role: 'owner',
    });
    expect(decideBoardPermission('manageAccess', authority('owner', true), ACTOR)).toEqual({
      allowed: false,
      code: ERROR_CODES.BOARD_ARCHIVED,
    });
    expect(decideBoardPermission('manageLifecycle', authority('owner', true), ACTOR)).toMatchObject(
      { allowed: true, role: 'owner' },
    );
    for (const role of ['editor', 'viewer'] as const) {
      expect(decideBoardPermission('manageAccess', authority(role, false), ACTOR)).toEqual({
        allowed: false,
        code: ERROR_CODES.FORBIDDEN,
      });
      expect(decideBoardPermission('manageLifecycle', authority(role, true), ACTOR)).toEqual({
        allowed: false,
        code: ERROR_CODES.FORBIDDEN,
      });
    }
  });

  it('derives owner from the board row even if an owner membership row is malformed', () => {
    expect(
      decideBoardPermission(
        'manageAccess',
        {
          ...authority('owner', false),
          memberRole: 'viewer',
        },
        ACTOR,
      ),
    ).toMatchObject({ allowed: true, role: 'owner' });
  });
});
