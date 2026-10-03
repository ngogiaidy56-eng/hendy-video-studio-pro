import { DurableObject } from 'cloudflare:workers';
import { Env } from '../types';

export class WebSocketServer extends DurableObject {
  private sessions: WebSocket[] = [];

  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    this.ctx.acceptWebSocket(server);
    this.sessions.push(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Broadcast tin nhắn tới tất cả clients kết nối
    this.sessions.forEach((session) => {
      try {
        session.send(`[Echo]: ${message}`);
      } catch (e) {
        // Handle closed sockets
      }
    });
  }

  async webSocketClose(ws: WebSocket) {
    this.sessions = this.sessions.filter((s) => s !== ws);
  }
}
