// What the app shows, as a pure function of what the server said.
//
// The server decides everything that matters (who is paired, when an offer
// closes). This reducer only mirrors it, so the four screens can never
// disagree with the engine about where the user is. No React, no clock:
// every action carries `now`, which keeps it testable with plain node.

import type { Answer, Estimate, RequeueReason, ServerMsg } from './protocol';

export type Link = 'connecting' | 'online' | 'offline' | 'replaced';

/** Why the user is back on the start screen. Wording lives in copy.ts. */
export type Notice =
  | { kind: 'wait_timeout'; budgetMs: number }
  | { kind: 'offer_timeout'; partnerName: string | null }
  | { kind: 'declined'; partnerName: string | null; neverAgain: boolean }
  | { kind: 'partner_ended_call'; partnerName: string }
  | { kind: 'connection_lost'; during: 'waiting' | 'offer' | 'call' }
  | { kind: 'error'; message: string };

export interface StartView {
  kind: 'start';
  notice: Notice | null;
  /** Join sent, no answer yet. */
  joining: boolean;
}

export interface WaitingView {
  kind: 'waiting';
  /** When this wait began. Kept across a requeue: the place in line is kept too. */
  since: number;
  /** When the server gives up. Reset on a requeue (fresh wait budget). */
  budgetEndsAt: number;
  estimate: Estimate | null;
  /** Set when the last offer fell through because of the other person. */
  requeue: { reason: RequeueReason; partnerName: string } | null;
  leaving: boolean;
}

export interface OfferView {
  kind: 'offer';
  waitSince: number;
  matchId: number;
  partnerId: string;
  partnerName: string;
  partnerRegion: string | null;
  languages: string[];
  topic: string | null;
  windowMs: number;
  expiresAt: number;
  answer: Answer | null;
  neverAgain: boolean;
}

export interface CallView {
  kind: 'call';
  matchId: number;
  partnerId: string;
  partnerName: string;
  partnerRegion: string | null;
  languages: string[];
  topic: string | null;
  startedAt: number;
}

export type View = StartView | WaitingView | OfferView | CallView;

export interface State {
  link: Link;
  view: View;
  /** From the server's hello; used for copy ("up to 10 minutes"). */
  waitBudgetMs: number;
  offerWindowMs: number;
}

export type Action =
  | { type: 'server'; msg: ServerMsg; now: number }
  | { type: 'link'; link: Link; now: number }
  | { type: 'join_sent' }
  | { type: 'leave_sent' }
  | { type: 'answer_sent'; answer: Answer; neverAgain: boolean }
  | { type: 'dismiss_notice' };

const start = (notice: Notice | null = null): StartView => ({ kind: 'start', notice, joining: false });

export const initialState: State = {
  link: 'connecting',
  view: start(),
  waitBudgetMs: 10 * 60 * 1000,
  offerWindowMs: 15 * 1000,
};

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'link':
      return onLink(state, action.link);
    case 'join_sent':
      return state.view.kind === 'start' ? { ...state, view: { ...state.view, joining: true, notice: null } } : state;
    case 'leave_sent':
      return state.view.kind === 'waiting' ? { ...state, view: { ...state.view, leaving: true } } : state;
    case 'answer_sent':
      return state.view.kind === 'offer' && state.view.answer === null
        ? { ...state, view: { ...state.view, answer: action.answer, neverAgain: action.neverAgain } }
        : state;
    case 'dismiss_notice':
      return state.view.kind === 'start' ? { ...state, view: { ...state.view, notice: null } } : state;
    case 'server':
      return onServer(state, action.msg, action.now);
  }
}

function onLink(state: State, link: Link): State {
  if (link === 'online' || link === 'connecting') return { ...state, link };
  // The server treats a dropped socket as leaving, from any phase. Say so
  // instead of showing a wait or a call that no longer exists.
  const v = state.view;
  if (v.kind === 'start') return { ...state, link, view: { ...v, joining: false } };
  const during = v.kind === 'waiting' ? 'waiting' : v.kind === 'offer' ? 'offer' : 'call';
  return { ...state, link, view: start({ kind: 'connection_lost', during }) };
}

function onServer(state: State, msg: ServerMsg, now: number): State {
  const v = state.view;
  switch (msg.type) {
    case 'hello': {
      // A new socket starts from nothing: the server dropped whatever the old
      // one held (a join in flight, a wait, an offer, a call). Apply the same
      // reset as losing the connection, so no screen or "Joining" button
      // outlives the socket that owned it. This covers reconnects that never
      // report "offline", such as the reconnect after a name change.
      const reset = onLink(state, 'offline').view;
      return { ...state, link: 'online', waitBudgetMs: msg.wait_budget_ms, offerWindowMs: msg.offer_window_ms, view: reset };
    }

    case 'joined':
      return {
        ...state,
        waitBudgetMs: msg.wait_budget_ms,
        view: {
          kind: 'waiting',
          since: now,
          budgetEndsAt: now + msg.wait_budget_ms,
          estimate: msg.estimate,
          requeue: null,
          leaving: false,
        },
      };

    case 'estimate':
      return v.kind === 'waiting' ? { ...state, view: { ...v, estimate: msg.estimate } } : state;

    case 'offer':
      return {
        ...state,
        view: {
          kind: 'offer',
          waitSince: v.kind === 'waiting' ? v.since : now,
          matchId: msg.match_id,
          partnerId: msg.partner,
          partnerName: msg.partner_name ?? msg.partner,
          partnerRegion: msg.partner_region ?? null,
          languages: msg.languages,
          topic: msg.topic,
          windowMs: msg.expires_in_ms,
          expiresAt: now + msg.expires_in_ms,
          answer: null,
          neverAgain: false,
        },
      };

    case 'call_started':
      return {
        ...state,
        view: {
          kind: 'call',
          matchId: msg.match_id,
          partnerId: msg.partner,
          partnerName: msg.partner_name ?? msg.partner,
          partnerRegion: msg.partner_region ?? null,
          languages: msg.languages,
          topic: msg.topic,
          startedAt: now,
        },
      };

    case 'requeued':
      return {
        ...state,
        view: {
          kind: 'waiting',
          since: v.kind === 'offer' ? v.waitSince : v.kind === 'waiting' ? v.since : now,
          budgetEndsAt: now + msg.wait_budget_ms,
          // The old estimate was for a different moment; the server sends a new one on its next pass.
          estimate: null,
          requeue: v.kind === 'offer' ? { reason: msg.reason, partnerName: v.partnerName } : null,
          leaving: false,
        },
      };

    case 'left': {
      const partnerName = v.kind === 'offer' ? v.partnerName : null;
      switch (msg.reason) {
        case 'cancelled':
          return { ...state, view: start() };
        case 'wait_timeout':
          return { ...state, view: start({ kind: 'wait_timeout', budgetMs: state.waitBudgetMs }) };
        case 'offer_timeout':
          return { ...state, view: start({ kind: 'offer_timeout', partnerName }) };
        case 'declined':
          return {
            ...state,
            view: start({ kind: 'declined', partnerName, neverAgain: v.kind === 'offer' && v.neverAgain }),
          };
      }
      return state;
    }

    case 'call_ended': {
      if (v.kind !== 'call' || v.matchId !== msg.match_id) return state;
      const notice: Notice | null =
        msg.reason === 'partner_left' ? { kind: 'partner_ended_call', partnerName: v.partnerName } : null;
      return { ...state, view: start(notice) };
    }

    case 'error':
      // "That offer is no longer open": the offer's own outcome message is on its way; nothing to add.
      if (msg.code === 'no_such_offer' || msg.code === 'not_in_call') return state;
      return v.kind === 'start' ? { ...state, view: start({ kind: 'error', message: msg.message }) } : state;

    case 'replaced':
      return { ...state, link: 'replaced', view: start() };

    case 'blocked':
    case 'pong':
      return state;
  }
}
