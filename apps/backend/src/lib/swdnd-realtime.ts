import type { Server, ServerWebSocket, WebSocketHandler } from 'bun';

export interface WsEnvelope {
  type: string;
  room: string;
  payload?: unknown;
}

export interface WsData {
  room: string;
}

let serverRef: Server | null = null;

/** Wire the running Bun server so REST handlers can broadcast. Call once after Bun.serve. */
export function setRealtimeServer(server: Server): void {
  serverRef = server;
}

/** Room key for a campaign. */
export function roomForCampaign(campaignId: string): string {
  return `campaign:${campaignId}`;
}

/** Broadcast an envelope to everyone in a room. No-op until the server is wired. */
export function publishToRoom(room: string, env: WsEnvelope): void {
  serverRef?.publish(room, JSON.stringify(env));
}

/** Parse + minimally validate an inbound message. Returns null when malformed. */
export function parseEnvelope(raw: string): WsEnvelope | null {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.type === 'string' && typeof obj.room === 'string') {
      return obj as WsEnvelope;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const swdndWebsocket: WebSocketHandler<WsData> = {
  open(ws: ServerWebSocket<WsData>) {
    ws.subscribe(ws.data.room);
    ws.send(JSON.stringify({ type: 'joined', room: ws.data.room }));
  },
  // NOTE: ws.publish() delivers to all OTHER subscribers in the room, not the
  // sender — intentional for ephemeral client frames. Authoritative state uses
  // publishToRoom() (server.publish), which reaches every subscriber.
  message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
    const env = parseEnvelope(typeof message === 'string' ? message : message.toString());
    if (!env || env.room !== ws.data.room) return;
    // Foundation: relay ephemeral client messages to the rest of the room.
    // Authoritative state changes go through REST + publishToRoom.
    ws.publish(ws.data.room, JSON.stringify(env));
  },
  close(ws: ServerWebSocket<WsData>) {
    ws.unsubscribe(ws.data.room);
  },
};
