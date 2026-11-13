import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateBeforeJoining, estimateWhileWaiting, list } from '../src/copy.ts';
import { initialState, reduce, type State } from '../src/session/reducer.ts';
import type { ServerMsg } from '../src/session/protocol.ts';

const feed = (s: State, now: number, ...msgs: ServerMsg[]) =>
  msgs.reduce((acc, msg) => reduce(acc, { type: 'server', msg, now }), s);

const est = { bucket: 'unknown', sample_size: 0, someone_waiting: false } as const;
const joined: ServerMsg = { type: 'joined', estimate: est, wait_budget_ms: 600_000 };
const offer: ServerMsg = {
  type: 'offer',
  match_id: 7,
  partner: 'u_b',
  partner_name: 'Bea',
  languages: ['english'],
  topic: null,
  expires_in_ms: 15_000,
};

test('join -> offer -> both ready -> call', () => {
  let s = feed(initialState, 1_000, joined);
  assert.equal(s.view.kind, 'waiting');
  s = feed(s, 5_000, offer);
  assert.equal(s.view.kind, 'offer');
  if (s.view.kind !== 'offer') return;
  assert.equal(s.view.expiresAt, 20_000);
  assert.equal(s.view.partnerName, 'Bea');
  s = reduce(s, { type: 'answer_sent', answer: 'ready', neverAgain: false });
  s = feed(s, 6_000, { type: 'call_started', match_id: 7, partner: 'u_b', partner_name: 'Bea', languages: ['english'], topic: null });
  assert.equal(s.view.kind, 'call');
});

test('partner declines: back to waiting, elapsed time kept, budget fresh', () => {
  let s = feed(initialState, 1_000, joined);
  s = feed(s, 61_000, offer);
  s = feed(s, 64_000, { type: 'requeued', reason: 'partner_declined', wait_budget_ms: 600_000 });
  assert.equal(s.view.kind, 'waiting');
  if (s.view.kind !== 'waiting') return;
  assert.equal(s.view.since, 1_000);
  assert.equal(s.view.budgetEndsAt, 664_000);
  assert.deepEqual(s.view.requeue, { reason: 'partner_declined', partnerName: 'Bea' });
  assert.equal(s.view.estimate, null);
});

test('not answering sends you to the start with the reason', () => {
  let s = feed(initialState, 0, joined, offer);
  s = feed(s, 15_000, { type: 'left', reason: 'offer_timeout' });
  assert.deepEqual(s.view, { kind: 'start', joining: false, notice: { kind: 'offer_timeout', partnerName: 'Bea' } });
});

test("declining with don't-match-again is remembered in the notice", () => {
  let s = feed(initialState, 0, joined, offer);
  s = reduce(s, { type: 'answer_sent', answer: 'decline', neverAgain: true });
  s = feed(s, 100, { type: 'left', reason: 'declined' });
  assert.deepEqual(s.view.kind === 'start' && s.view.notice, { kind: 'declined', partnerName: 'Bea', neverAgain: true });
});

test('a second answer is ignored', () => {
  let s = feed(initialState, 0, joined, offer);
  s = reduce(s, { type: 'answer_sent', answer: 'ready', neverAgain: false });
  s = reduce(s, { type: 'answer_sent', answer: 'decline', neverAgain: true });
  assert.equal(s.view.kind === 'offer' && s.view.answer, 'ready');
});

test('waiting the whole budget and cancelling', () => {
  let s = feed(initialState, 0, joined, { type: 'left', reason: 'wait_timeout' });
  assert.deepEqual(s.view.kind === 'start' && s.view.notice, { kind: 'wait_timeout', budgetMs: 600_000 });
  s = feed(initialState, 0, joined, { type: 'left', reason: 'cancelled' });
  assert.deepEqual(s.view, { kind: 'start', joining: false, notice: null });
});

test('losing the connection never leaves a stale wait or call on screen', () => {
  let s = feed(initialState, 0, joined);
  s = reduce(s, { type: 'link', link: 'offline', now: 1 });
  assert.deepEqual(s.view.kind === 'start' && s.view.notice, { kind: 'connection_lost', during: 'waiting' });
});

test('a new socket clears a join that the old socket never finished', () => {
  // Renaming reconnects the socket without ever reporting "offline".
  const hello: ServerMsg = { type: 'hello', user_id: 'u_a', state: { phase: 'idle' }, offer_window_ms: 15_000, wait_budget_ms: 600_000 };
  let s = reduce(initialState, { type: 'join_sent' });
  assert.equal(s.view.kind === 'start' && s.view.joining, true);
  s = feed(s, 2_000, hello);
  assert.equal(s.link, 'online');
  assert.equal(s.view.kind === 'start' && s.view.joining, false, 'the button must not stay on "Joining"');

  // The same silent reconnect during a wait: the server has dropped the place.
  let w = feed(initialState, 1_000, joined);
  w = feed(w, 3_000, hello);
  assert.equal(w.view.kind, 'start');
  assert.deepEqual(w.view.kind === 'start' && w.view.notice, { kind: 'connection_lost', during: 'waiting' });
});

test('partner leaving the call is explained; a stale call_ended is ignored', () => {
  const started: ServerMsg = { type: 'call_started', match_id: 7, partner: 'u_b', partner_name: 'Bea', languages: ['english'], topic: 'sports' };
  let s = feed(initialState, 0, joined, offer, started);
  assert.equal(feed(s, 1, { type: 'call_ended', match_id: 99, reason: 'partner_left' }).view.kind, 'call');
  s = feed(s, 1, { type: 'call_ended', match_id: 7, reason: 'partner_left' });
  assert.deepEqual(s.view.kind === 'start' && s.view.notice, { kind: 'partner_ended_call', partnerName: 'Bea' });
});

test('estimate copy never invents a number', () => {
  assert.equal(estimateBeforeJoining(est, ['english'], false).headline, 'No estimate yet');
  assert.equal(estimateBeforeJoining({ ...est, bucket: 'under_a_minute', someone_waiting: true }, ['english', 'spanish'], false).detail, 'Someone who speaks English or Spanish is waiting right now.');
  assert.equal(estimateBeforeJoining({ bucket: 'a_few_minutes', sample_size: 4, someone_waiting: false }, ['hindi'], false).detail, 'Based on 4 recent matches.');
  assert.equal(estimateWhileWaiting(null).headline, 'Updating the estimate');
  assert.equal(list(['english', 'spanish', 'hindi']), 'English, Spanish and Hindi');
});
