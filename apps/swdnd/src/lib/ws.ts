import { API_BASE } from "./api";

export interface WsEnvelope {
  type: string;
  room: string;
  payload?: unknown;
}

export interface CampaignSocket {
  send(env: WsEnvelope): void;
  close(): void;
}

function wsBase(): string {
  return API_BASE.replace(/^http/, "ws");
}

/** Connect to a campaign room with auto-reconnect. */
export function connectCampaign(
  campaignId: string,
  onMessage: (env: WsEnvelope) => void,
  onStatus?: (open: boolean) => void,
  token?: string | null,
): CampaignSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry = 0;

  const open = () => {
    ws = new WebSocket(
      `${wsBase()}/swdnd/ws?campaign=${encodeURIComponent(campaignId)}${token ? `&token=${encodeURIComponent(token)}` : ''}`,
    );
    ws.onopen = () => {
      retry = 0;
      onStatus?.(true);
    };
    ws.onclose = () => {
      onStatus?.(false);
      if (!closed) {
        retry += 1;
        setTimeout(open, Math.min(1000 * retry, 5000));
      }
    };
    ws.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data as string) as WsEnvelope);
      } catch {
        /* ignore non-JSON frames */
      }
    };
  };
  open();

  return {
    send(env) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(env));
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
