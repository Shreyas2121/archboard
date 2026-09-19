import {
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
  type GraphProjection,
} from '@archboard/contracts';
import { createNode } from '@archboard/document-model';

import { LOCAL_DEMO_USER_KEY } from '../config/index.js';
import { listBoardStorageNamespaceRecords } from '../persistence/namespace-storage.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from '../persistence/namespace.js';
import { LOCK_HINT_TYPES, WRITER_LOCK_VERSION } from './constants.js';
import { lockHintChannelName } from './names.js';
import {
  BrowserWriterSession,
  type WriterSessionSnapshot,
  WriterLockRequiredError,
} from './writer-session.js';

const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 140;

export interface WriterLockHarness {
  snapshot(): WriterSessionSnapshot;
  projection(): GraphProjection;
  mutate(title: string): Promise<boolean>;
  localUpdateCount(): Promise<number>;
  outboxCount(): Promise<number>;
  announceResetComplete(): void;
  forgeReleaseHint(): void;
  close(): Promise<void>;
}

declare global {
  interface Window {
    archboardWriterLockHarness?: WriterLockHarness;
    archboardWriterLockHarnessReady?: Promise<void>;
  }
}

function graphNode(title: string): GraphNode {
  return {
    id: crypto.randomUUID(),
    kind: 'component',
    position: { x: 0, y: 0 },
    size: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    title,
    color: COLOR_TOKENS.BLUE,
    content: {
      category: COMPONENT_CATEGORIES.SERVICE,
      description: '',
      technology: 'TypeScript',
      externalUrl: null,
    },
  };
}

const parameters = new URLSearchParams(window.location.search);
const boardId = parameters.get('boardId');
if (boardId === null) throw new Error('Writer-lock harness requires boardId.');

const namespace: BoardStorageNamespace = {
  deploymentOrigin: window.location.origin,
  userId: LOCAL_DEMO_USER_KEY,
  boardId,
  graphSchemaVersion: GRAPH_SCHEMA_VERSION,
};

window.archboardWriterLockHarnessReady = BrowserWriterSession.open({ namespace }).then(
  (session) => {
    window.archboardWriterLockHarness = {
      snapshot: () => session.getSnapshot(),
      projection: () => session.getProjection(),
      async mutate(title) {
        try {
          session.executeMutation((document) => createNode(document, graphNode(title)));
          await session.whenIdle();
          return true;
        } catch (error) {
          if (error instanceof WriterLockRequiredError) return false;
          throw error;
        }
      },
      async localUpdateCount() {
        return (await listBoardStorageNamespaceRecords(namespace)).localUpdates.length;
      },
      async outboxCount() {
        return (await listBoardStorageNamespaceRecords(namespace)).outbox.length;
      },
      announceResetComplete: () => session.announceResetComplete(),
      forgeReleaseHint() {
        const channel = new BroadcastChannel(lockHintChannelName(namespace));
        channel.postMessage({
          version: WRITER_LOCK_VERSION,
          namespace: boardStorageNamespaceKey(namespace),
          type: LOCK_HINT_TYPES.LOCK_RELEASED,
        });
        channel.close();
      },
      close: () => session.close(),
    };
    window.addEventListener('pagehide', () => void session.close(), { once: true });
  },
);
