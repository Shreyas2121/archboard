import {
  AI_DIAGRAM_FOCUSES,
  MAX_AI_PROMPT_CHARACTERS,
  type AiDiagramFocus,
} from '@archboard/contracts';

export const DEFAULT_AI_DIAGRAM_FOCUS = AI_DIAGRAM_FOCUSES.OVERVIEW;
export const AI_DIAGRAM_FOCUS_OPTIONS: Readonly<
  Record<
    AiDiagramFocus,
    { label: string; description: string; extraction: string; generation: string }
  >
> = {
  overview: {
    label: 'System overview',
    description: 'Applications, services, storage and external integrations.',
    extraction:
      'Capture the main applications, services, storage and external integrations and their principal connections. Keep internal implementation details out unless essential to explain a system boundary.',
    generation:
      'Show the main system boundaries and principal connections. Keep internal implementation details out unless essential to explain a system boundary.',
  },
  api: {
    label: 'API / request flow',
    description: 'Entry points, authentication, service calls and responses.',
    extraction:
      'Trace a representative request through routes/controllers, authentication/authorization, application services and relevant storage or integration calls. Include supported direction and response flow. Inspect only source needed for this flow, not every endpoint. Treat modules inside a monolith as internal responsibilities, not separate deployments.',
    generation:
      'Trace supported requests from entry points through authentication, services and relevant storage/integrations. Label request purposes and protocols concisely. Do not invent missing endpoints or return paths.',
  },
  database: {
    label: 'Database / data flow',
    description: 'Data stores, meaningful entities, relationships and reads/writes.',
    extraction:
      'Inspect storage adapters, ORM models/entities and migration source without executing migrations or connecting to a database. Capture data stores, meaningful domain entities, supported relationships, and the modules that read/write them. Use category database for actual stores and generic for domain entities. Prioritize entity relationships over repetitive store-to-entity "persists" connections; record shared storage membership in technologies, groups or descriptions unless individual access flows are the requested focus. Describe verified keys/relationships in concise descriptions or evidence. This shared format supports a data-flow view, not a complete table/column ERD; do not add tables, columns or key fields to the JSON contract.',
    generation:
      'Show supported data stores, meaningful domain entities and relationships, and the components that read/write them. Use generic components for entities. Prioritize entity relationships; summarize repetitive store-to-entity "persists" connections in groups or commentary unless individual access flows are requested. Explain unknown relationships outside the diagram; do not present inferred columns or keys as a verified ERD.',
  },
  storage: {
    label: 'Storage infrastructure',
    description: 'Databases, object storage, caches and the services that access them.',
    extraction:
      'Inspect supported storage clients and access flows. Include stores and their callers; keep entity relationships in a separate database view. Do not connect to services or read secrets.',
    generation:
      'Show supported stores and access flows without entity/foreign-key detail. Do not invent connections between stores or unsupported policy/index claims.',
  },
  modules: {
    label: 'Internal modules',
    description: 'Responsibilities and dependencies within each application.',
    extraction:
      'Inspect module registrations, service boundaries and imports/calls to identify meaningful internal responsibilities and dependencies. Do not collapse a modular backend into one opaque API card. Group modules within their application and explicitly identify a monolith rather than implying independent services. Do not create a component for every file or package dependency.',
    generation:
      'Show meaningful internal responsibilities and supported dependencies. Group modules within their application and distinguish module boundaries from independently deployed services.',
  },
  deployment: {
    label: 'Deployment',
    description: 'Hosts, containers and infrastructure supported by configuration.',
    extraction:
      'Inspect checked-in container, deployment, infrastructure-as-code and CI/CD configuration. Include only supported hosts, containers, runtime services, gateways and external infrastructure and their connections. Put missing production topology in unknowns. Use generic for hosting/container boundaries and appropriate categories for contained services. Do not read .env files, private URLs or live cloud resources.',
    generation:
      'Show only hosts, containers, runtime services and infrastructure supported by the supplied configuration/evidence. Keep missing deployment details in commentary; never invent a hosting provider, replica topology or production environment.',
  },
};

const DEFAULT_FILE_DIAGRAM_INSTRUCTIONS =
  'Diagram the existing architecture described in the supplied project context. Show its meaningful components, responsibilities and directed connections, using supplied groups where helpful. Use short card descriptions and connection labels. Explain unknowns and constraints outside the diagram. Do not invent unsupported components or connections.';

function diagramFocusInstructions(focus: AiDiagramFocus): string {
  const option = AI_DIAGRAM_FOCUS_OPTIONS[focus];
  return `Diagram focus: ${option.label}. ${option.generation}`;
}

export function fileDiagramPrompt(
  focus: AiDiagramFocus = DEFAULT_AI_DIAGRAM_FOCUS,
  instructions = '',
): string {
  return `${diagramFocusInstructions(focus)}\n\n${instructions.trim() ? instructions : DEFAULT_FILE_DIAGRAM_INSTRUCTIONS}`;
}

export function maxFileDiagramInstructions(focus: AiDiagramFocus): number {
  return MAX_AI_PROMPT_CHARACTERS - `${diagramFocusInstructions(focus)}\n\n`.length;
}
