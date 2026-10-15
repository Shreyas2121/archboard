import type { ProjectContextV1 } from '@archboard/contracts';
import { AI_DIAGRAM_FOCUS_OPTIONS, DEFAULT_AI_DIAGRAM_FOCUS } from './ai-diagram-focus';

export function AiContextReview({ context }: { readonly context: ProjectContextV1 }) {
  return (
    <div
      className="grid min-w-0 gap-3 text-xs *:min-w-0 [overflow-wrap:anywhere]"
      aria-label="Complete reviewed project context"
    >
      <p className="text-sm font-medium [overflow-wrap:anywhere]">{context.project.name}</p>
      <p>
        Diagram focus:{' '}
        {AI_DIAGRAM_FOCUS_OPTIONS[context.diagramFocus ?? DEFAULT_AI_DIAGRAM_FOCUS].label}
      </p>
      <p className="whitespace-pre-wrap break-words">{context.project.description}</p>
      <p className="break-words">
        Technologies: {context.project.technologies.join(', ') || 'None supplied'}
      </p>
      <h5 className="font-medium">Components ({context.components.length})</h5>
      {context.components.map((component) => (
        <div key={component.key} className="grid min-w-0 gap-1 rounded-md border p-2 *:min-w-0">
          <p className="break-words font-medium">
            {component.name} · {component.key}
          </p>
          <p className="break-words">
            {component.category} · {component.technology || 'Technology not supplied'}
          </p>
          <p className="whitespace-pre-wrap break-words">{component.description}</p>
          {component.evidenceKeys.length > 0 && (
            <p className="break-words">Evidence: {component.evidenceKeys.join(', ')}</p>
          )}
        </div>
      ))}
      <h5 className="font-medium">Connections ({context.connections.length})</h5>
      {context.connections.map((connection, index) => (
        <div
          key={`${index}:${connection.source}:${connection.target}`}
          className="grid min-w-0 gap-1 rounded-md border p-2 *:min-w-0"
        >
          <p className="break-words">
            {connection.source} → {connection.target}
          </p>
          <p className="whitespace-pre-wrap break-words">
            {connection.label} · {connection.protocol}
          </p>
          {connection.evidenceKeys.length > 0 && (
            <p className="break-words">Evidence: {connection.evidenceKeys.join(', ')}</p>
          )}
        </div>
      ))}
      <h5 className="font-medium">Visual groups ({context.groups.length})</h5>
      {context.groups.map((group) => (
        <p key={group.key} className="whitespace-pre-wrap break-words">
          {group.title} ({group.key}): {group.componentKeys.join(', ')}
        </p>
      ))}
      <h5 className="font-medium">Evidence excerpts ({context.evidence.length})</h5>
      {context.evidence.map((evidence) => (
        <div key={evidence.key} className="grid min-w-0 gap-1 rounded-md border p-2 *:min-w-0">
          <p className="break-words">
            {evidence.key}: {evidence.path}, lines {evidence.startLine}–{evidence.endLine}
          </p>
          {evidence.sha256 && <p className="break-all">SHA-256: {evidence.sha256}</p>}
          <pre className="whitespace-pre-wrap break-words">{evidence.excerpt}</pre>
        </div>
      ))}
      <h5 className="font-medium">Constraints</h5>
      {context.constraints.map((constraint, index) => (
        <p key={`${index}:${constraint}`} className="whitespace-pre-wrap break-words">
          {constraint}
        </p>
      ))}
      <h5 className="font-medium">Unknowns and open questions</h5>
      {context.unknowns.map((unknown, index) => (
        <p key={`${index}:${unknown}`} className="whitespace-pre-wrap break-words">
          {unknown}
        </p>
      ))}
    </div>
  );
}
