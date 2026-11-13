import { clock, estimateBeforeJoining, estimateLine, list, noticeCopy, presenceLine, requeueLine } from '../src/copy';
import { flag, regionName } from '../src/regions';
import { starter } from '../src/topics';

const unknown = { bucket: 'unknown', sample_size: 0, someone_waiting: false } as const;

describe('copy', () => {
  test('with no data the estimate says so instead of inventing a number', () => {
    expect(estimateLine(unknown)).toBe('No wait estimate yet');
    expect(estimateLine(null)).toBe('Checking the wait');
  });

  test('someone waiting right now is "likely", never a promise; once you are waiting it is not counted', () => {
    const e = { bucket: 'a_few_minutes', sample_size: 4, someone_waiting: true } as const;
    expect(estimateLine(e)).toBe('Likely under a minute');
    expect(estimateLine(e, { waiting: true })).toBe('Usually a few minutes');
  });

  test('the start screen line covers no languages and no connection', () => {
    expect(estimateBeforeJoining(null, [], false)).toBe('Pick a language first');
    expect(estimateBeforeJoining(null, ['english'], true)).toBe("Can't check the wait");
    expect(estimateBeforeJoining({ bucket: 'over_five_minutes', sample_size: 3, someone_waiting: false }, ['hindi'], false)).toBe('May take over five minutes');
  });

  test('presence is a count, nothing more', () => {
    expect(presenceLine(null)).toBe('Looking…');
    expect(presenceLine(0)).toBe('Nobody yet');
    expect(presenceLine(1)).toBe('1 person');
    expect(presenceLine(7)).toBe('7 people');
  });

  test('every way back to the start says what happened, briefly', () => {
    expect(noticeCopy({ kind: 'wait_timeout', budgetMs: 600_000 }).body).toContain('10 minutes');
    expect(noticeCopy({ kind: 'offer_timeout', partnerName: 'Li' }).body).toContain("didn't answer in time");
    expect(noticeCopy({ kind: 'declined', partnerName: 'Li', neverAgain: true }).body).toBe("You won't be matched with Li again.");
    expect(noticeCopy({ kind: 'declined', partnerName: 'Li', neverAgain: false }).body).toBe('You left the queue.');
    expect(noticeCopy({ kind: 'connection_lost', during: 'call' }).body).toBe('The call ended.');
    expect(requeueLine('partner_timed_out', 'Li')).toBe("Li didn't answer. You're still first in line.");
  });

  test('lists and clocks read naturally', () => {
    expect(list(['english', 'spanish', 'hindi'])).toBe('English, Spanish and Hindi');
    expect(list(['english', 'spanish'], 'or')).toBe('English or Spanish');
    expect(clock(125_000)).toBe('2:05');
  });

  test('both phones in a match start on the same conversation starter', () => {
    expect(starter('travel', 12)).toBe(starter('travel', 12));
    expect(starter('travel', 12, 1)).not.toBe(starter('travel', 12));
    expect(starter(null, 3)).toMatch(/\?$/);
  });

  test('flags come from country codes, and a missing or malformed one is never guessed', () => {
    expect(flag('BR')).toBe('🇧🇷');
    expect(regionName('BR')).toBe('Brazil');
    expect(regionName('NZ')).toBe('NZ'); // a real country this list has no name for
    expect(flag('NZ')).toBe('🇳🇿');
    for (const bad of [null, undefined, '', 'br', 'BRA', '12']) {
      expect(flag(bad)).toBe('🌍');
      expect(regionName(bad)).toBe('Somewhere');
    }
  });
});
