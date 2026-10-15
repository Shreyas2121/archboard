import { describe, expect, it } from 'vitest';
import { AI_DIAGRAM_FOCUSES, MAX_AI_PROMPT_CHARACTERS } from '@archboard/contracts';
import {
  fileDiagramPrompt,
  maxFileDiagramInstructions,
} from '@/features/editor/ai/ai-diagram-focus';
import {
  contextFromForm,
  emptyAiForm,
  reviewAiRequest,
} from '@/features/editor/ai/ai-review-model';

const BOARD_ID = '00000000-0000-4000-8000-000000000001';

describe('focused diagram request preparation', () => {
  it.each(Object.values(AI_DIAGRAM_FOCUSES))(
    'includes %s in the reviewed context without mutating the uploaded file',
    (focus) => {
      const context = contextFromForm({ ...emptyAiForm(), name: 'Project' });
      const original = structuredClone(context);
      const instructions = '  Explain the order lifecycle.\n';
      const reviewed = reviewAiRequest(instructions, BOARD_ID, context, focus);
      expect(reviewed.context?.diagramFocus).toBe(focus);
      expect(reviewed.prompt).toBe(fileDiagramPrompt(focus, instructions));
      expect(reviewed.prompt.endsWith(instructions)).toBe(true);
      expect(context).toEqual(original);
    },
  );

  it.each(Object.values(AI_DIAGRAM_FOCUSES))(
    'reserves room for the %s prefix at the shared request limit',
    (focus) => {
      const maximum = maxFileDiagramInstructions(focus);
      const accepted = reviewAiRequest('x'.repeat(maximum), BOARD_ID, undefined, focus);
      expect(accepted.prompt).toHaveLength(MAX_AI_PROMPT_CHARACTERS);
      expect(() => reviewAiRequest('x'.repeat(maximum + 1), BOARD_ID, undefined, focus)).toThrow();
    },
  );
});
