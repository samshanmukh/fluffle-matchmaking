import { act } from '@testing-library/react-native';

import type { ClientMsg, Estimate, ServerMsg } from '../../src/session/protocol';
import type { Presence } from '../../src/session/usePresence';

/**
 * Stands in for the Rust server: the app opens this instead of a real
 * WebSocket, the test plays the server's side and reads what the app sent.
 */
export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];

  static reset() {
    FakeSocket.all = [];
  }
  static get latest(): FakeSocket {
    const s = FakeSocket.all[FakeSocket.all.length - 1];
    if (!s) throw new Error('the app has not opened a socket');
    return s;
  }

  readyState = FakeSocket.CONNECTING;
  sent: ClientMsg[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as ClientMsg);
  }
  close() {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
}

/** What the app sent, without heartbeats. */
export function sent(): ClientMsg[] {
  return FakeSocket.latest.sent.filter((m) => m.type !== 'ping');
}

export async function say(msg: ServerMsg) {
  await act(async () => {
    FakeSocket.latest.onmessage?.({ data: JSON.stringify(msg) });
  });
}

export async function connect() {
  await act(async () => {
    FakeSocket.latest.readyState = FakeSocket.OPEN;
    FakeSocket.latest.onopen?.();
  });
  await say({ type: 'hello', user_id: 'u_test', state: { phase: 'idle' }, offer_window_ms: 15_000, wait_budget_ms: 600_000 });
}

export async function drop() {
  await act(async () => {
    FakeSocket.latest.close();
  });
}

export const UNKNOWN: Estimate = { bucket: 'unknown', sample_size: 0, someone_waiting: false };

export const NOBODY: Presence = { online: 0, waiting: 0, people: [] };

/** Answers GET /estimate and GET /presence. */
export function serveEstimate(estimate: Estimate, presence: Presence = NOBODY) {
  const fetchMock = jest.fn(async (url: string) => ({ ok: true, json: async () => (url.includes('/presence') ? presence : estimate) }));
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

export const offer = (over: Partial<Extract<ServerMsg, { type: 'offer' }>> = {}): ServerMsg => ({
  type: 'offer',
  match_id: 7,
  partner: 'u_bea',
  partner_name: 'Bea',
  partner_region: 'BR',
  languages: ['english'],
  topic: null,
  expires_in_ms: 15_000,
  ...over,
});
