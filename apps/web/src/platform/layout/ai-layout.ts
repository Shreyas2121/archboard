// Compatibility for retired assistant fixtures. The active importer uses the local layout worker.
export {
  layoutProjectDiagram as layoutAiDiagram,
  type ProjectLayoutWorker as AiLayoutWorker,
  type ProjectLayoutWorkerFactory as AiLayoutWorkerFactory,
} from './project-layout';
