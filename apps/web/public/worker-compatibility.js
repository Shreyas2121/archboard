/* global self */
// Keep these values in step with GRAPH_SCHEMA_VERSION and SYNC_DATABASE_VERSION.
const GRAPH_SCHEMA_VERSION = 1;
const SYNC_DATABASE_VERSION = 2;

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'ARCHBOARD_UPDATE_COMPATIBILITY') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      event.ports[0]?.postMessage({
        type: 'ARCHBOARD_UPDATE_COMPATIBILITY',
        graphSchemaVersion: GRAPH_SCHEMA_VERSION,
        syncDatabaseVersion: SYNC_DATABASE_VERSION,
        openClientCount: clients.length,
      });
    }),
  );
});
