// Every sentence the app says about waiting, in one place, so it can be read
// (and argued with) without opening a screen. The rule: say what we know, say
// what we do not know, never promise a match.

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

function basis(e: Estimate): string {
  return e.sample_size === 1 ? 'Based on 1 recent match.' : `Based on ${e.sample_size} recent matches.`;
}

export interface EstimateCopy {
  headline: string;
  detail: string;
}

/** Start screen, before joining. */
export function estimateBeforeJoining(e: Estimate | null, languages: string[], unreachable: boolean): EstimateCopy {
  if (languages.length === 0) return { headline: 'Pick a language to see the wait', detail: 'You can choose up to five.' };
  if (unreachable) return { headline: 'Wait time unavailable', detail: "We can't reach Fluffle right now." };
  if (!e) return { headline: 'Checking the wait', detail: ' ' };
  if (e.someone_waiting) {
    return {
      headline: 'Likely under a minute',
      detail: `Someone who speaks ${list(languages, 'or')} is waiting right now.`,
    };
  }
  switch (e.bucket) {
    case 'under_a_minute':
      return { headline: 'Usually under a minute', detail: basis(e) };
    case 'a_few_minutes':
      return { headline: 'Usually a few minutes', detail: basis(e) };
    case 'over_five_minutes':
      return { headline: 'May take over five minutes', detail: basis(e) };
    case 'unknown':
      return {
        headline: 'No estimate yet',
        detail: 'Nobody is waiting in these languages, and there are too few recent matches to guess.',
      };
  }
}

/** Waiting screen. The server never reports a bucket the person has already outlasted. */
export function estimateWhileWaiting(e: Estimate | null): EstimateCopy {
  if (!e) return { headline: 'Updating the estimate', detail: ' ' };
  switch (e.bucket) {
    case 'under_a_minute':
      return { headline: 'Usually under a minute', detail: basis(e) };
    case 'a_few_minutes':
      return { headline: 'Usually a few minutes', detail: basis(e) };
    case 'over_five_minutes':
      return { headline: 'This may take over five minutes', detail: basis(e) };
    case 'unknown':
      return {
        headline: "We can't estimate this wait",
        detail: 'There are too few recent matches in your languages to give an honest number.',
      };
  }
}

export function requeueLine(reason: RequeueReason, partnerName: string): string {
  return reason === 'partner_declined'
    ? `${partnerName} passed this time. You kept your place at the front.`
    : `${partnerName} didn't answer in time. You kept your place at the front.`;
}

export function noticeCopy(n: Notice): { title: string; body: string } {
  switch (n.kind) {
    case 'wait_timeout':
      return {
        title: 'No match this time',
        body: `Nobody who fits was free in ${minutes(n.budgetMs)}, so we stopped looking. Your choices are still here if you want to try again.`,
      };
    case 'offer_timeout':
      return {
        title: 'You missed the match',
        body: `${n.partnerName ?? 'Your match'} was ready to be asked, but the offer ran out before you answered, so we took you out of the queue.`,
      };
    case 'declined':
      return n.neverAgain
        ? {
            title: `You won't be matched with ${n.partnerName ?? 'them'} again`,
            body: 'You are out of the queue. Start a new search whenever you like.',
          }
        : {
            title: 'You passed on that match',
            body: 'Passing takes you out of the queue. Start a new search whenever you like.',
          };
    case 'partner_ended_call':
      return { title: `${n.partnerName} ended the call`, body: 'Start a new search whenever you like.' };
    case 'connection_lost':
      return {
        title: 'Connection lost',
        body:
          n.during === 'call'
            ? 'The connection dropped, so the call ended.'
            : 'The connection dropped, so you are no longer in the queue.',
      };
    case 'error':
      return { title: "That didn't work", body: label(n.message) };
  }
}
