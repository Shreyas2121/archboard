import { applicationIdSchema } from '@archboard/contracts';

const UUID_SUFFIX_LENGTH = 12;
const HEXADECIMAL_RADIX = 16;
const FIRST_ORDINAL = 1;
const SECOND_ORDINAL = 2;
const THIRD_ORDINAL = 3;
const FOURTH_ORDINAL = 4;

export const FIXTURE_NAMESPACES = {
  NODE: '10000000',
  EDGE: '20000000',
  BOUNDARY: '30000000',
  STEP: '40000000',
  CLIENT: '50000000',
  UPDATE: '60000000',
} as const;

export type FixtureNamespace = (typeof FIXTURE_NAMESPACES)[keyof typeof FIXTURE_NAMESPACES];

export function fixtureId(namespace: FixtureNamespace, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new Error('Fixture ID ordinals must be non-negative safe integers.');
  }

  const suffix = ordinal.toString(HEXADECIMAL_RADIX).padStart(UUID_SUFFIX_LENGTH, '0');
  return applicationIdSchema.parse(`${namespace}-0000-4000-8000-${suffix}`);
}

export const FIXED_IDS = {
  NODE_A: fixtureId(FIXTURE_NAMESPACES.NODE, FIRST_ORDINAL),
  NODE_B: fixtureId(FIXTURE_NAMESPACES.NODE, SECOND_ORDINAL),
  NODE_C: fixtureId(FIXTURE_NAMESPACES.NODE, THIRD_ORDINAL),
  NODE_D: fixtureId(FIXTURE_NAMESPACES.NODE, FOURTH_ORDINAL),
  EDGE_A: fixtureId(FIXTURE_NAMESPACES.EDGE, FIRST_ORDINAL),
  EDGE_B: fixtureId(FIXTURE_NAMESPACES.EDGE, SECOND_ORDINAL),
  BOUNDARY_A: fixtureId(FIXTURE_NAMESPACES.BOUNDARY, FIRST_ORDINAL),
  STEP_A: fixtureId(FIXTURE_NAMESPACES.STEP, FIRST_ORDINAL),
  STEP_B: fixtureId(FIXTURE_NAMESPACES.STEP, SECOND_ORDINAL),
  CLIENT_A: fixtureId(FIXTURE_NAMESPACES.CLIENT, FIRST_ORDINAL),
  CLIENT_B: fixtureId(FIXTURE_NAMESPACES.CLIENT, SECOND_ORDINAL),
  UPDATE_A: fixtureId(FIXTURE_NAMESPACES.UPDATE, FIRST_ORDINAL),
  UPDATE_B: fixtureId(FIXTURE_NAMESPACES.UPDATE, SECOND_ORDINAL),
} as const;
