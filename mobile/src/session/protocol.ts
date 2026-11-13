// The wire protocol of backend/src/server.rs, as TypeScript types.
// One WebSocket per user at /ws?user_id=..&name=.., JSON text frames both ways.

export type Bucket = 'under_a_minute' | 'a_few_minutes' | 'over_five_minutes' | 'unknown';

export interface Estimate {
  bucket: Bucket;
  /** Recent matches the bucket is based on (0 when it comes from who is waiting now). */
  sample_size: number;
  /** Someone who shares a language is waiting right now. */
  someone_waiting: boolean;
}

export type LeftReason = 'cancelled' | 'declined' | 'offer_timeout' | 'wait_timeout';
export type RequeueReason = 'partner_declined' | 'partner_timed_out';
export type CallEndReason = 'you_ended' | 'partner_left';
export type Answer = 'ready' | 'decline';

export type ServerPhase =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'offered'; match_id: number }
  | { phase: 'in_call'; match_id: number };

export type ServerMsg =
  | { type: 'hello'; user_id: string; state: ServerPhase; offer_window_ms: number; wait_budget_ms: number }
  | { type: 'joined'; estimate: Estimate; wait_budget_ms: number }
  | { type: 'estimate'; estimate: Estimate }
  | {
      type: 'offer';
      match_id: number;
      partner: string;
      partner_name?: string;
      languages: string[];
      topic: string | null;
      expires_in_ms: number;
    }
  | {
      type: 'call_started';
      match_id: number;
      partner: string;
      partner_name?: string;
      languages: string[];
      topic: string | null;
    }
  | { type: 'requeued'; reason: RequeueReason; wait_budget_ms: number }
  | { type: 'left'; reason: LeftReason }
  | { type: 'call_ended'; match_id: number; reason: CallEndReason }
  | { type: 'error'; code: string; message: string }
  | { type: 'blocked'; user_id: string }
  | { type: 'replaced' }
  | { type: 'pong' };

export type ClientMsg =
  | { type: 'join'; languages: string[]; topic: string | null }
  | { type: 'leave' }
  | { type: 'respond'; match_id: number; answer: Answer; never_again: boolean }
  | { type: 'end_call' }
  | { type: 'ping' };
