import { PROJECT_CONTEXT_FOCUSES, type ProjectContextFocus } from '@archboard/contracts';

export const DEFAULT_PROJECT_CONTEXT_FOCUS = PROJECT_CONTEXT_FOCUSES.OVERVIEW;
export function projectContextFilename(focus: ProjectContextFocus): string {
  return focus === 'database' || focus === 'storage'
    ? `archboard.${focus}-context.json`
    : 'archboard.project-context.json';
}

export const PROJECT_CONTEXT_FOCUS_OPTIONS: Readonly<
  Record<ProjectContextFocus, { label: string; description: string; extraction: string }>
> = {
  overview: {
    label: 'System overview',
    description: 'Applications, services, storage and external integrations.',
    extraction:
      'Capture the main applications, services, storage and external integrations and their principal connections. Keep internal implementation details out unless essential to explain a system boundary.',
  },
  api: {
    label: 'API / request flow',
    description: 'Entry points, authentication, service calls and responses.',
    extraction:
      'Trace a representative request through routes/controllers, authentication/authorization, application services and relevant storage or integration calls. Include supported direction and response flow. Inspect only source needed for this flow, not every endpoint. Treat modules inside a monolith as internal responsibilities, not separate deployments.',
  },
  database: {
    label: 'Database relationships',
    description: 'Entities, join tables and supported relationships, without infrastructure.',
    extraction:
      'Inspect ORM models/entities and migration source without executing migrations or connecting to a database. Include only meaningful entities and their supported relationships, using category generic. Keep database servers, buckets, caches, application services, storage access flows and deployment infrastructure out of this view; use Storage infrastructure for those. Record the database/ORM in technology text or group titles instead of adding a database card and repeated "persists" edges. Represent an important join table as its own component; do not label a many-to-many association as one direct foreign key. Keep distinct tables separate when their relationships matter. Group by domain, with short names and concise labels such as "Has sources (1:N)". Cite the actual constraint definition for every Foreign Key or cascade claim, including table-level/composite constraints when applicable. An ID field alone does not establish a foreign key or delete behavior; label a code-supported logical reference accordingly and put missing constraint proof in unknowns. Keep RLS, encryption, vector dimensions and index implementation out of relationship arrows; any relevant verified detail belongs in descriptions or constraints with its own evidence. Do not infer those details from package names or symbolic constants. This shared format is an entity overview, not a complete table/column ERD; do not add tables, columns or key fields to the JSON contract.',
  },
  storage: {
    label: 'Storage infrastructure',
    description: 'Databases, object storage, caches and the services that access them.',
    extraction:
      'Inspect checked-in storage clients/adapters, relevant configuration structure, and the source that calls them, without connecting to a database or external service. Show actual database stores, object storage/buckets, caches and only the application services or workers needed to explain verified reads, writes and uploads. Use category database for relational/vector/object stores, cache for caches, and service for access responsibilities. Keep entity/table cards, foreign-key/cascade relationships and curriculum/schema details out of this view; use Database relationships for those. Group by application or storage boundary and use short labels such as "Uploads originals" or "Reads source metadata", putting transport in protocol. A shared provider does not prove that two stores communicate. Do not invent service nodes or edges to connect otherwise disconnected stores. Cite access code for each flow. Claim RLS, encryption, a vector dimension, an index type, or deletion/cleanup behavior only when the corresponding policy, configuration, constant/index definition or implementation is included in evidence; otherwise put it in unknowns or omit it. Never read .env files, credentials, private connection strings or live cloud resources.',
  },
  modules: {
    label: 'Internal modules',
    description: 'Responsibilities and dependencies within each application.',
    extraction:
      'Inspect module registrations, service boundaries and imports/calls to identify meaningful internal responsibilities and dependencies. Do not collapse a modular backend into one opaque API card. Group modules within their application and explicitly identify a monolith rather than implying independent services. Do not create a component for every file or package dependency.',
  },
  deployment: {
    label: 'Deployment',
    description: 'Hosts, containers and infrastructure supported by configuration.',
    extraction:
      'Inspect checked-in container, deployment, infrastructure-as-code and CI/CD configuration. Include only supported hosts, containers, runtime services, gateways and external infrastructure and their connections. Put missing production topology in unknowns. Use generic for hosting/container boundaries and appropriate categories for contained services. Do not read .env files, private URLs or live cloud resources.',
  },
};
