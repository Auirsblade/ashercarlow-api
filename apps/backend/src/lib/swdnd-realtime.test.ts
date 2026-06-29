import { describe, it, expect } from 'bun:test';
import {
  parseEnvelope,
  roomForCampaign,
  swdndWebsocket,
  setRealtimeServer,
  publishToRoom,
  type WsData,
} from './swdnd-realtime';

describe('parseEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    expect(parseEnvelope('{"type":"x","room":"campaign:1"}')).toEqual({
      type: 'x',
      room: 'campaign:1',
    });
  });
  it('rejects malformed input', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope('{"type":"x"}')).toBeNull();
  });
});

describe('roomForCampaign', () => {
  it('namespaces the room', () => {
    expect(roomForCampaign('abc')).toBe('campaign:abc');
  });
});

describe('websocket room fan-out', () => {
  it('delivers a published message to subscribers in the room', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        const room = roomForCampaign('t1');
        if (srv.upgrade<WsData>(req, { data: { room } })) return undefined;
        return new Response('no', { status: 400 });
      },
      websocket: swdndWebsocket,
    });
    setRealtimeServer(server);

    const url = `ws://localhost:${server.port}/swdnd/ws?campaign=t1`;
    const got = new Promise<string>((resolve) => {
      const ws = new WebSocket(url);
      ws.onmessage = (e) => {
        const env = JSON.parse(e.data as string);
        if (env.type === 'campaign:updated') resolve(env.payload);
      };
      ws.onopen = () => {
        setTimeout(() => publishToRoom(roomForCampaign('t1'), {
          type: 'campaign:updated',
          room: roomForCampaign('t1'),
          payload: 'hello',
        }), 50);
      };
    });

    expect(await got).toBe('hello');
    server.stop(true);
  }, 3000);

  it('relays a client message to other subscribers in the same room', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        const room = roomForCampaign('t2');
        if (srv.upgrade<WsData>(req, { data: { room } })) return undefined;
        return new Response('no', { status: 400 });
      },
      websocket: swdndWebsocket,
    });
    setRealtimeServer(server);

    const url = `ws://localhost:${server.port}/swdnd/ws?campaign=t2`;
    const a = new WebSocket(url);
    const b = new WebSocket(url);

    const received = new Promise<string>((resolve) => {
      b.onmessage = (e) => {
        const env = JSON.parse(e.data as string);
        if (env.type === 'cursor') resolve(env.payload as string);
      };
    });

    await new Promise<void>((resolve) => {
      let open = 0;
      const onopen = () => { open += 1; if (open === 2) resolve(); };
      a.onopen = onopen;
      b.onopen = onopen;
    });

    a.send(JSON.stringify({ type: 'cursor', room: roomForCampaign('t2'), payload: 'ping' }));

    expect(await received).toBe('ping');
    server.stop(true);
  }, 3000);
});
