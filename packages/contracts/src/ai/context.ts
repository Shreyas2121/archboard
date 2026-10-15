import { z } from 'zod';

import { COMPONENT_CATEGORIES } from '../graph/index.js';
import * as limits from '../limits/index.js';
import {
  AI_SCHEMA_VERSION,
  aiByteLimit,
  aiNonblankTextSchema,
  aiReferences,
  aiSemanticKeySchema,
  aiTextSchema,
  aiUniqueKeys,
} from './common.js';

const ASCII_SPACE = 32;
const ASCII_DELETE = 127;

export const AI_DIAGRAM_FOCUSES = {
  OVERVIEW: 'overview',
  API: 'api',
  DATABASE: 'database',
  STORAGE: 'storage',
  MODULES: 'modules',
  DEPLOYMENT: 'deployment',
} as const;
export const aiDiagramFocusSchema = z.enum(AI_DIAGRAM_FOCUSES);
export type AiDiagramFocus = z.infer<typeof aiDiagramFocusSchema>;
// Neutral names for the local project-context workflow; legacy AI contracts keep
// their exports for persisted/request compatibility.
export const PROJECT_CONTEXT_FOCUSES = AI_DIAGRAM_FOCUSES;
export const projectContextFocusSchema = aiDiagramFocusSchema;
export type ProjectContextFocus = AiDiagramFocus;

export const aiEvidencePathSchema = z
  .string()
  .min(1)
  .max(limits.MAX_AI_PATH_CHARACTERS)
  .refine((path) => {
    const parts = path.split('/');
    return (
      !/[\\:?#]/.test(path) &&
      !Array.from(path).some(
        (character) =>
          character.charCodeAt(0) < ASCII_SPACE || character.charCodeAt(0) === ASCII_DELETE,
      ) &&
      parts.every((part) => part.length > 0 && part !== '.' && part !== '..')
    );
  }, 'Evidence paths must be project-relative forward-slash paths without traversal or URLs.');

export const aiEvidenceSchema = z
  .strictObject({
    key: aiSemanticKeySchema,
    path: aiEvidencePathSchema,
    startLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    endLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    excerpt: z.string().max(limits.MAX_AI_EVIDENCE_EXCERPT_CHARACTERS),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .refine((entry) => entry.endLine >= entry.startLine, {
    path: ['endLine'],
    message: 'End line must not precede start line.',
  });

export const projectContextV1Schema = aiByteLimit(
  z
    .strictObject({
      kind: z.literal('archboard.project-context'),
      schemaVersion: z.literal(AI_SCHEMA_VERSION),
      diagramFocus: aiDiagramFocusSchema.optional(),
      project: z.strictObject({
        name: z.string().min(1).max(limits.MAX_NODE_TITLE_CHARACTERS),
        description: aiTextSchema,
        technologies: z
          .array(z.string().max(limits.MAX_TECHNOLOGY_CHARACTERS))
          .max(limits.MAX_AI_LIST_ITEMS)
          .default([]),
      }),
      components: z
        .array(
          z.strictObject({
            key: aiSemanticKeySchema,
            name: z.string().min(1).max(limits.MAX_NODE_TITLE_CHARACTERS),
            category: z.enum(COMPONENT_CATEGORIES),
            technology: z.string().max(limits.MAX_TECHNOLOGY_CHARACTERS),
            description: z.string().max(limits.MAX_COMPONENT_DESCRIPTION_CHARACTERS),
            evidenceKeys: z
              .array(aiSemanticKeySchema)
              .max(limits.MAX_AI_EVIDENCE_ENTRIES)
              .default([]),
          }),
        )
        .max(limits.MAX_AI_CONTEXT_COMPONENTS)
        .default([]),
      connections: z
        .array(
          z.strictObject({
            source: aiSemanticKeySchema,
            target: aiSemanticKeySchema,
            label: z.string().max(limits.MAX_EDGE_LABEL_CHARACTERS),
            protocol: z.string().max(limits.MAX_EDGE_PROTOCOL_CHARACTERS),
            evidenceKeys: z
              .array(aiSemanticKeySchema)
              .max(limits.MAX_AI_EVIDENCE_ENTRIES)
              .default([]),
          }),
        )
        .max(limits.MAX_AI_CONTEXT_CONNECTIONS)
        .default([]),
      groups: z
        .array(
          z.strictObject({
            key: aiSemanticKeySchema,
            title: z.string().max(limits.MAX_BOUNDARY_TITLE_CHARACTERS),
            componentKeys: z.array(aiSemanticKeySchema).max(limits.MAX_AI_CONTEXT_COMPONENTS),
          }),
        )
        .max(limits.MAX_AI_CONTEXT_GROUPS)
        .default([]),
      evidence: z.array(aiEvidenceSchema).max(limits.MAX_AI_EVIDENCE_ENTRIES).default([]),
      constraints: z.array(aiNonblankTextSchema).max(limits.MAX_AI_LIST_ITEMS).default([]),
      unknowns: z.array(aiNonblankTextSchema).max(limits.MAX_AI_LIST_ITEMS).default([]),
    })
    .superRefine((value, context) => {
      const components = aiUniqueKeys(value.components, ['components'], context);
      aiUniqueKeys(value.groups, ['groups'], context);
      const evidence = aiUniqueKeys(value.evidence, ['evidence'], context);
      value.components.forEach((component, index) =>
        aiReferences(
          component.evidenceKeys,
          evidence,
          ['components', index, 'evidenceKeys'],
          context,
        ),
      );
      value.connections.forEach((connection, index) => {
        aiReferences(
          [connection.source, connection.target],
          components,
          ['connections', index],
          context,
        );
        aiReferences(
          connection.evidenceKeys,
          evidence,
          ['connections', index, 'evidenceKeys'],
          context,
        );
      });
      value.groups.forEach((group, index) =>
        aiReferences(group.componentKeys, components, ['groups', index, 'componentKeys'], context),
      );
      if (
        value.evidence.reduce((sum, entry) => sum + Array.from(entry.excerpt).length, 0) >
        limits.MAX_AI_EVIDENCE_TOTAL_CHARACTERS
      )
        context.addIssue({
          code: 'custom',
          path: ['evidence'],
          message: 'Aggregate evidence excerpt budget exceeded.',
        });
    }),
  limits.MAX_AI_CONTEXT_FILE_BYTES,
);

// Validate the raw file before JSON.parse: whitespace/escaping also consume upload bytes.
export function parseProjectContextFile(text: string): ProjectContextV1 {
  z.string()
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= limits.MAX_AI_CONTEXT_FILE_BYTES,
      'Context file byte budget exceeded.',
    )
    .parse(text);
  return projectContextV1Schema.parse(JSON.parse(text));
}

export type ProjectContextV1 = z.infer<typeof projectContextV1Schema>;
export type AiEvidence = z.infer<typeof aiEvidenceSchema>;
