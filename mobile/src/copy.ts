// Every sentence the app says, in one place, so it can be read (and argued
// with) without opening a screen. Two rules: say only what we know, and say
// it in one short line.

import type { Estimate, RequeueReason } from './session/protocol';
import type { Notice } from './session/reducer';

export function label(id: string): string {
  return id
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** "English", "English and Spanish", "English, Spanish and Hindi". */
export function list(ids: string[], joiner: 'and' | 'or' = 'and'): string {
  const names = ids.map(label);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${joiner} ${names[names.length - 1]}`;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/** The wait estimate as one line. With too little data it says so; it never invents a number. */
export function estimateLine(e: Estimate | null, opts: { waiting?: boolean } = {}): string {
  if (!e) return 'Checking the wait';
  if (e.someone_waiting && !opts.waiting) return 'Likely under a minute';
  switch (e.bucket) {
    case 'under_a_minute':
      return 'Usually under a minute';
    case 'a_few_minutes':
      return 'Usually a few minutes';
    case 'over_five_minutes':
      return 'May take over five minutes';
    case 'unknown':
      return 'No wait estimate yet';
  }
}

/** Start screen: the line under "Find a match". */
export function estimateBeforeJoining(e: Estimate | null, languages: string[], unreachable: boolean): string {
  if (languages.length === 0) return 'Pick a language first';
  if (unreachable) return "Can't check the wait";
  return estimateLine(e);
}

/** Start screen: how many people are waiting who share a language. */
export function presenceLine(waiting: number | null): string {
  if (waiting === null) return 'Looking…';
  if (waiting === 0) return 'Nobody yet';
  return waiting === 1 ? '1 person' : `${waiting} people`;
}

export function budgetLine(leftMs: number): string {
  return leftMs > 0 ? `We'll look for up to ${minutes(leftMs)} more.` : 'Wrapping up.';
}

export function requeueLine(reason: RequeueReason, partnerName: string): string {
  return reason === 'partner_declined'
    ? `${partnerName} skipped. You're still first in line.`
    : `${partnerName} didn't answer. You're still first in line.`;
}

export function noticeCopy(n: Notice): { title: string; body: string } {
  switch (n.kind) {
    case 'wait_timeout':
      return { title: 'No one was free', body: `We looked for ${minutes(n.budgetMs)}. Try again any time.` };
    case 'offer_timeout':
      return { title: 'You missed that match', body: "You didn't answer in time, so you left the queue." };
    case 'declined':
      return n.neverAgain
        ? { title: 'Got it', body: `You won't be matched with ${n.partnerName ?? 'them'} again.` }
        : { title: 'Skipped', body: 'You left the queue.' };
    case 'partner_ended_call':
      return { title: `${n.partnerName} ended the call`, body: '' };
    case 'connection_lost':
      return { title: 'Connection lost', body: n.during === 'call' ? 'The call ended.' : 'You left the queue.' };
    case 'error':
      return { title: "That didn't work", body: `${n.message[0]?.toUpperCase() ?? ''}${n.message.slice(1)}.` };
  }
}
