export {
  WEB_APPLICATION_TEMPLATE_NAME,
  instantiateWebApplicationTemplate,
  webApplicationTemplate,
} from './web-application.js';

import {
  portableGraphProjectionSchema,
  templateIdSchema,
  type TemplateId,
} from '@archboard/contracts';
import { webApplicationTemplate } from './web-application.js';
import { eventProcessingTemplate, serviceBoundaryTemplate } from './architecture-examples.js';
export { eventProcessingTemplate, serviceBoundaryTemplate } from './architecture-examples.js';
export const TEMPLATE_CHOICES: ReadonlyArray<{
  id: TemplateId;
  title: string;
  description: string;
}> = [
  {
    id: 'web-application',
    title: 'Web application',
    description: 'Browser, API, cache and database; four request steps.',
  },
  {
    id: 'event-processing',
    title: 'Event processing',
    description: 'Queue, worker, persistence and safe retries; three steps.',
  },
  {
    id: 'service-boundary',
    title: 'Service boundary',
    description: 'Identity and application ownership; three steps.',
  },
];
const templates = {
  'web-application': webApplicationTemplate,
  'event-processing': eventProcessingTemplate,
  'service-boundary': serviceBoundaryTemplate,
};
/** Fixed IDs only; returns a validated copy of the registry graph. */
export function resolveTemplate(id: TemplateId) {
  return portableGraphProjectionSchema.parse(templates[templateIdSchema.parse(id)]);
}
