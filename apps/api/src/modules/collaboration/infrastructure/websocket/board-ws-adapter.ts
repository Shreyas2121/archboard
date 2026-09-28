import { MAX_WS_FRAME_BYTES } from '@archboard/contracts';
import type { INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { WebSocketServer } from 'ws';

const HTTP_APPLICATION_PORT = 0;

/** Nest owns the connection lifecycle; the authenticated upgrade service owns dynamic paths. */
export class BoardWsAdapter extends WsAdapter {
  public override create(port: number): WebSocketServer {
    if (port !== HTTP_APPLICATION_PORT) throw new Error('Board sockets require the HTTP server.');
    return new WebSocketServer({
      noServer: true,
      maxPayload: MAX_WS_FRAME_BYTES,
      perMessageDeflate: false,
    });
  }

  public override bindMessageHandlers(...args: Parameters<WsAdapter['bindMessageHandlers']>): void {
    // The gateway validates complete raw frames so unknown events cannot disappear in adapter routing.
    if (args[1].length > 0) super.bindMessageHandlers(...args);
  }
}

export function configureCollaborationWebSockets(application: INestApplication): void {
  application.useWebSocketAdapter(new BoardWsAdapter(application));
}
