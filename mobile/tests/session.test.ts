import type { ServerMsg } from '../src/session/protocol';
import { initialState, reduce, type State } from '../src/session/reducer';

const feed = (s: State, now: number, ...msgs: ServerMsg[]) => msgs.reduce((acc, msg) => reduce(acc, { type: 'server', msg, now }), s);

const est = { bucket: 'unknown', sample_size: 0, someone_waiting: false } as const;
const joined: ServerMsg = { type: 'joined', estimate: est, wait_budget_ms: 600_000 };
const offer: ServerMsg = { type: 'offer', match_id: 7, partner: 'u_b', partner_name: 'Bea', languages: ['english'], topic: null, expires_in_ms: 15_000 };
const started: ServerMsg = { type: 'call_started', match_id: 7, partner: 'u_b', partner_name: 'Bea', languages: ['english'], topic: 'sports' };

describe('session reducer', () => {
  test('join, offer, both ready, call', () => {
    let s = feed(initialState, 1_000, joined);
    expect(s.view.kind).toBe('waiting');
    s = feed(s, 5_000, offer);
    expect(s.view).toMatchObject({ kind: 'offer', expiresAt: 20_000, partnerName: 'Bea' });
    s = reduce(s, { type: 'answer_sent', answer: 'ready', neverAgain: false });
    s = feed(s, 6_000, started);
    expect(s.view.kind).toBe('call');
  });

  test('partner skips: back to waiting, elapsed time kept, wait budget fresh', () => {
    let s = feed(initialState, 1_000, joined);
    s = feed(s, 61_000, offer);
    s = feed(s, 64_000, { type: 'requeued', reason: 'partner_declined', wait_budget_ms: 600_000 });
    expect(s.view).toMatchObject({
      kind: 'waiting',
      since: 1_000,
      budgetEndsAt: 664_000,
      estimate: null,
      requeue: { reason: 'partner_declined', partnerName: 'Bea' },
    });
  });

  test('not answering returns to the start with the reason', () => {
    let s = feed(initialState, 0, joined, offer);
    s = feed(s, 15_000, { type: 'left', reason: 'offer_timeout' });
    expect(s.view).toEqual({ kind: 'start', joining: false, notice: { kind: 'offer_timeout', partnerName: 'Bea' } });
  });

  test("skipping with don't-match-again is remembered", () => {
    let s = feed(initialState, 0, joined, offer);
    s = reduce(s, { type: 'answer_sent', answer: 'decline', neverAgain: true });
    s = feed(s, 100, { type: 'left', reason: 'declined' });
    expect(s.view).toMatchObject({ kind: 'start', notice: { kind: 'declined', partnerName: 'Bea', neverAgain: true } });
  });

  test('a second answer to the same offer is ignored', () => {
    let s = feed(initialState, 0, joined, offer);
    s = reduce(s, { type: 'answer_sent', answer: 'ready', neverAgain: false });
    s = reduce(s, { type: 'answer_sent', answer: 'decline', neverAgain: true });
    expect(s.view).toMatchObject({ kind: 'offer', answer: 'ready', neverAgain: false });
  });

  test('waiting the whole budget, and cancelling', () => {
    expect(feed(initialState, 0, joined, { type: 'left', reason: 'wait_timeout' }).view).toMatchObject({
      kind: 'start',
      notice: { kind: 'wait_timeout', budgetMs: 600_000 },
    });
    expect(feed(initialState, 0, joined, { type: 'left', reason: 'cancelled' }).view).toEqual({ kind: 'start', joining: false, notice: null });
  });

  test('losing the connection never leaves a stale wait on screen', () => {
    let s = feed(initialState, 0, joined);
    s = reduce(s, { type: 'link', link: 'offline', now: 1 });
    expect(s.view).toMatchObject({ kind: 'start', notice: { kind: 'connection_lost', during: 'waiting' } });
  });

  test('a stale call_ended is ignored; the real one is explained', () => {
    let s = feed(initialState, 0, joined, offer, started);
    expect(feed(s, 1, { type: 'call_ended', match_id: 99, reason: 'partner_left' }).view.kind).toBe('call');
    s = feed(s, 90_000, { type: 'call_ended', match_id: 7, reason: 'partner_left' });
    expect(s.view).toMatchObject({ kind: 'start', notice: { kind: 'partner_ended_call', partnerName: 'Bea' } });
  });

  test('a new socket clears a join that the old socket never finished', () => {
    // Renaming reconnects the socket without ever reporting "offline".
    const hello: ServerMsg = { type: 'hello', user_id: 'u_a', state: { phase: 'idle' }, offer_window_ms: 15_000, wait_budget_ms: 600_000 };
    let s = reduce(initialState, { type: 'join_sent' });
    expect(s.view).toMatchObject({ kind: 'start', joining: true });
    s = feed(s, 2_000, hello);
    expect(s.link).toBe('online');
    expect(s.view).toMatchObject({ kind: 'start', joining: false });

    // The same silent reconnect during a wait: the server has dropped the place.
    let w = feed(initialState, 1_000, joined);
    w = feed(w, 3_000, hello);
    expect(w.view).toMatchObject({ kind: 'start', notice: { kind: 'connection_lost', during: 'waiting' } });
  });
});
