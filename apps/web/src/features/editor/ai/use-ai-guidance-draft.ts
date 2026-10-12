import { useEffect, useRef, useState } from 'react';
import {
  GUIDANCE_STARTERS,
  type AiGuidanceHistory,
  type AiGuidanceTask,
  type AiPresentationMode,
} from './ai-guidance-model';

/** Private draft ownership outlives the dialog, but never the board/account scope. */
export function useAiGuidanceDraft(identity: boolean) {
  const [task, setTask] = useState<AiGuidanceTask>('explain-selection');
  const [prompt, setPrompt] = useState(GUIDANCE_STARTERS['explain-selection']);
  const [history, setHistory] = useState<AiGuidanceHistory>([]);
  const [problem, setProblem] = useState('');
  const [presentationMode, setPresentationMode] = useState<AiPresentationMode>('append');
  const reviewedSelection = useRef('');
  useEffect(() => {
    if (!identity) {
      setHistory([]);
      setPrompt(GUIDANCE_STARTERS['explain-selection']);
      setTask('explain-selection');
      setPresentationMode('append');
      setProblem('');
      reviewedSelection.current = '';
    }
  }, [identity]);
  return {
    task,
    setTask,
    prompt,
    setPrompt,
    history,
    setHistory,
    problem,
    setProblem,
    presentationMode,
    setPresentationMode,
    reviewedSelection,
  };
}
