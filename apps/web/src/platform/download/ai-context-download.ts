import { projectContextV1Schema, type ProjectContextV1 } from '@archboard/contracts';

export function downloadAiContext(context: ProjectContextV1): void {
  const json = JSON.stringify(projectContextV1Schema.parse(context));
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'archboard-project-context.json';
  anchor.rel = 'noopener';
  try {
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
