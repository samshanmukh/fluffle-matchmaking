import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import App from '../App';
import { tapGuard } from '../src/useTapGuard';
import { FakeSocket, NOBODY, UNKNOWN, connect, drop, offer, say, sent, serveEstimate } from './support/fakeServer';

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

/** Opens the app as "Sam", connected, on the home screen. */
async function open(estimate = UNKNOWN, presence = NOBODY) {
  serveEstimate(estimate, presence);
  await AsyncStorage.setItem('fluffle.identity.v1', JSON.stringify({ id: 'u_test', name: 'Sam' }));
  await render(<App />);
  await screen.findByText('Hi, Sam');
  await connect();
}

async function joinQueue() {
  await press('Find a match');
  await say({ type: 'joined', estimate: UNKNOWN, wait_budget_ms: 600_000 });
}

describe('matchmaking flow', () => {
  test('runs against the platform target named in the results column', () => {
    expect(['ios', 'android']).toContain(Platform.OS);
    expect(expect.getState().testPath).toBeDefined();
  });

  describe('start screen', () => {
    test('connects as the saved identity and shows the wait for the chosen languages', async () => {
      const fetchMock = serveEstimate({ bucket: 'a_few_minutes', sample_size: 4, someone_waiting: false });
      await AsyncStorage.setItem('fluffle.identity.v1', JSON.stringify({ id: 'u_test', name: 'Sam' }));
      await render(<App />);
      await screen.findByText('Hi, Sam');
      expect(FakeSocket.latest.url).toContain('user_id=u_test');
      expect(FakeSocket.latest.url).toContain('name=Sam');
      expect(FakeSocket.latest.url).toContain('region=US'); // from the phone's region setting
      await connect();
      expect((await screen.findAllByText('Usually a few minutes')).length).toBeGreaterThan(0);
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(expect.arrayContaining([expect.stringContaining('/estimate?languages=english'), expect.stringContaining('/presence?languages=english')]));
    });

    test('cannot match before the server is reachable', async () => {
      serveEstimate(UNKNOWN);
      await render(<App />);
      await screen.findByText(/^Hi, /);
      expect(screen.getByRole('button', { name: 'Find a match' })).toBeDisabled();
      await connect();
      expect(screen.getByRole('button', { name: 'Find a match' })).toBeEnabled();
    });

    test('needs at least one language and allows at most five', async () => {
      await open();
      await fireEvent.press(screen.getByRole('checkbox', { name: 'English' }));
      expect(screen.getByRole('button', { name: 'Find a match' })).toBeDisabled();
      expect(screen.getByText('Pick a language first')).toBeOnTheScreen();

      for (const language of ['English', 'Spanish', 'Hindi', 'French', 'German']) {
        await fireEvent.press(screen.getByRole('checkbox', { name: language }));
      }
      expect(screen.getByText(/5 of 5/)).toBeOnTheScreen();
      expect(screen.getByRole('checkbox', { name: 'Korean' })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: 'Hindi' })).toBeEnabled();
    });

    test('joins with the chosen languages and one optional topic', async () => {
      await open();
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Spanish' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Travel' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Politics' }));
      await press('Find a match');
      expect(sent()).toEqual([{ type: 'join', languages: ['english', 'spanish'], topic: 'politics' }]);
    });

    test('joins with no topic when "Anything" is chosen', async () => {
      await open();
      await fireEvent.press(screen.getByRole('radio', { name: 'Music' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'Anything' }));
      await press('Find a match');
      expect(sent()).toEqual([{ type: 'join', languages: ['english'], topic: null }]);
    });
  });

  describe('waiting screen', () => {
    test('shows what is being looked for, an honest estimate, and a way out', async () => {
      await open();
      await joinQueue();
      expect(screen.getByText('Finding you someone')).toBeOnTheScreen();
      expect(screen.getByText('Looking · speaks English')).toBeOnTheScreen();
      expect(screen.getByText('No wait estimate yet')).toBeOnTheScreen();
      expect(screen.getByLabelText(/^Waiting for 0:0\d$/)).toBeOnTheScreen();

      await press('Stop looking');
      expect(sent()[sent().length - 1]).toEqual({ type: 'leave' });
      await say({ type: 'left', reason: 'cancelled' });
      expect(screen.getByText(/Find someone/)).toBeOnTheScreen();
    });

    test('the estimate updates live while waiting', async () => {
      await open();
      await joinQueue();
      await say({ type: 'estimate', estimate: { bucket: 'a_few_minutes', sample_size: 6, someone_waiting: false } });
      expect(screen.getByText('Usually a few minutes')).toBeOnTheScreen();
    });

    test('waiting the whole budget returns to the start and says why', async () => {
      await open();
      await joinQueue();
      await say({ type: 'left', reason: 'wait_timeout' });
      expect(screen.getByText('No one was free')).toBeOnTheScreen();
      expect(screen.getByText(/We looked for 10 minutes/)).toBeOnTheScreen();
    });
  });

  describe('match offer', () => {
    test('shows who, the shared languages and topic, and the countdown', async () => {
      await open();
      await joinQueue();
      await say(offer({ languages: ['english', 'spanish'], topic: 'travel' }));
      expect(screen.getByText('Say hi to')).toBeOnTheScreen();
      expect(screen.getByText('Bea')).toBeOnTheScreen();
      expect(screen.getByText('English')).toBeOnTheScreen();
      expect(screen.getByText('Spanish')).toBeOnTheScreen();
      expect(screen.getByText('Travel')).toBeOnTheScreen();
      expect(screen.getByText(/^1[45] seconds to answer$/)).toBeOnTheScreen();
    });

    test('ready, then the call starts only when the server says both are ready', async () => {
      await open();
      await joinQueue();
      await say(offer());
      await press("I'm ready");
      expect(sent()[sent().length - 1]).toEqual({ type: 'respond', match_id: 7, answer: 'ready', never_again: false });
      expect(screen.getByText("You're in. Waiting for Bea.")).toBeOnTheScreen();
      expect(screen.queryByText(/^On a call/)).toBeNull();
      expect(screen.queryByRole('button', { name: "I'm ready" })).toBeNull();

      await say({ type: 'call_started', match_id: 7, partner: 'u_bea', partner_name: 'Bea', languages: ['english'], topic: null });
      expect(screen.getByText(/^On a call/)).toBeOnTheScreen();
    });

    test('"Not now" declines without blocking, and explains the consequence', async () => {
      await open();
      await joinQueue();
      await say(offer());
      await press('Not now');
      expect(sent()[sent().length - 1]).toEqual({ type: 'respond', match_id: 7, answer: 'decline', never_again: false });
      await say({ type: 'left', reason: 'declined' });
      expect(screen.getByText('Skipped')).toBeOnTheScreen();
      expect(screen.getByText('You left the queue.')).toBeOnTheScreen();
    });

    test('"Don\'t match us again" declines and blocks', async () => {
      await open();
      await joinQueue();
      await say(offer());
      await press("Don't match us again");
      expect(sent()[sent().length - 1]).toEqual({ type: 'respond', match_id: 7, answer: 'decline', never_again: true });
      await say({ type: 'left', reason: 'declined' });
      expect(screen.getByText("You won't be matched with Bea again.")).toBeOnTheScreen();
    });

    test('if the partner skips, you go back to waiting and are told you kept your place', async () => {
      await open();
      await joinQueue();
      await say(offer());
      await press("I'm ready");
      await say({ type: 'requeued', reason: 'partner_declined', wait_budget_ms: 600_000 });
      expect(screen.getByText('Finding you someone')).toBeOnTheScreen();
      expect(screen.getByText("Bea skipped. You're still first in line.")).toBeOnTheScreen();
    });

    test('not answering in time returns to the start and says why', async () => {
      await open();
      await joinQueue();
      await say(offer());
      await say({ type: 'left', reason: 'offer_timeout' });
      expect(screen.getByText('You missed that match')).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('alert'));
      expect(screen.queryByText('You missed that match')).toBeNull();
    });
  });

  describe('call screen', () => {
    async function startCall(topic: string | null) {
      await open();
      await joinQueue();
      await say(offer({ topic }));
      await press("I'm ready");
      await say({ type: 'call_started', match_id: 7, partner: 'u_bea', partner_name: 'Bea', languages: ['english', 'hindi'], topic });
    }

    test('shows the agreed languages and topic, with a starter about it', async () => {
      await startCall('travel');
      expect(screen.getByText('Bea')).toBeOnTheScreen();
      expect(screen.getByText('English')).toBeOnTheScreen();
      expect(screen.getByText('Hindi')).toBeOnTheScreen();
      expect(screen.getByText('Travel')).toBeOnTheScreen();
      expect(screen.getByText('Try asking')).toBeOnTheScreen();
      expect(screen.getByText(/no audio/)).toBeOnTheScreen();
    });

    test('says so when there is no agreed topic', async () => {
      await startCall(null);
      expect(screen.getByText('No set topic')).toBeOnTheScreen();
    });

    test('ending the call tells the server and returns to the start', async () => {
      await startCall(null);
      await press('End call');
      expect(sent()[sent().length - 1]).toEqual({ type: 'end_call' });
      await say({ type: 'call_ended', match_id: 7, reason: 'you_ended' });
      expect(screen.getByText(/Find someone/)).toBeOnTheScreen();
    });

    test('when the partner leaves, the start screen says who ended it', async () => {
      await startCall(null);
      await say({ type: 'call_ended', match_id: 7, reason: 'partner_left' });
      expect(screen.getByText('Bea ended the call')).toBeOnTheScreen();
    });
  });

  describe('regions and flags', () => {
    test('every language chip carries a flag', async () => {
      await open();
      for (const emoji of ['🇬🇧', '🇪🇸', '🇮🇳', '🇫🇷', '🇵🇹', '🇩🇪', '🇸🇦', '🇨🇳', '🇯🇵', '🇰🇷', '🇮🇹', '🇹🇷']) {
        expect(screen.getByText(emoji)).toBeOnTheScreen();
      }
    });

    test('the offer and the call show where each of you is connecting from', async () => {
      await open();
      await joinQueue();
      await say(offer({ partner_region: 'BR' }));
      expect(screen.getByText('United States')).toBeOnTheScreen();
      expect(screen.getByText('🇺🇸')).toBeOnTheScreen();
      expect(screen.getByText('Brazil')).toBeOnTheScreen();
      expect(screen.getByText('🇧🇷')).toBeOnTheScreen();

      await press("I'm ready");
      await say({ type: 'call_started', match_id: 7, partner: 'u_bea', partner_name: 'Bea', partner_region: 'BR', languages: ['english'], topic: null });
      expect(screen.getByText('Brazil')).toBeOnTheScreen();
      expect(screen.getByText('United States')).toBeOnTheScreen();
    });

    test('two people in the same country are told so; an unknown region is not guessed', async () => {
      await open();
      await joinQueue();
      await say(offer({ partner_region: 'US' }));
      expect(screen.getByText("You're both in United States")).toBeOnTheScreen();

      await say(offer({ match_id: 8, partner_region: null }));
      expect(screen.getByText('Somewhere')).toBeOnTheScreen();
      expect(screen.getByText('🌍')).toBeOnTheScreen();
    });

    test('your region is detected from the phone and shown as a fact, not a control', async () => {
      await open();
      expect(screen.getByText(/United States/)).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: /United States/ })).toBeNull();
    });
  });

  describe("who's here right now", () => {
    test('says so plainly when nobody is waiting, and keeps the wait estimate', async () => {
      await open({ bucket: 'a_few_minutes', sample_size: 4, someone_waiting: false });
      expect(await screen.findByText('Nobody yet')).toBeOnTheScreen();
      expect(await screen.findByText('Usually a few minutes')).toBeOnTheScreen();
    });

    test('shows who is online and how many are ready to match, without naming them', async () => {
      await open(UNKNOWN, {
        online: 3,
        waiting: 1,
        people: [
          { avatar: 11, region: 'JP', waiting: true },
          { avatar: 22, region: 'BR', waiting: false },
          { avatar: 33, region: 'JP', waiting: false },
        ],
      });
      expect(await screen.findByText('3 online · 1 ready')).toBeOnTheScreen();
      expect(screen.queryByText('Japan')).toBeNull(); // no country list: the flag is a badge on each avatar
      expect(screen.getAllByText('🇯🇵').length).toBe(3); // the Japanese language chip, and a badge on each of the two people in Japan
      expect(screen.getByText('🇧🇷')).toBeOnTheScreen();
    });

    test('asks again for the languages you pick', async () => {
      const fetchMock = serveEstimate(UNKNOWN);
      await AsyncStorage.setItem('fluffle.identity.v1', JSON.stringify({ id: 'u_test', name: 'Sam' }));
      await render(<App />);
      await screen.findByText('Hi, Sam');
      await connect();
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Hindi' }));
      await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/presence?languages=english%2Chindi&user_id=u_test'))).toBe(true));
    });
  });

  describe('accidental taps', () => {
    test('a second tap of "Find a match" does not cancel the wait that just began', async () => {
      tapGuard.ms = 600;
      await open();
      await joinQueue();
      await press('Stop looking');
      expect(sent().map((m) => m.type)).toEqual(['join']);
      await new Promise((r) => setTimeout(r, 650));
      await press('Stop looking');
      expect(sent().map((m) => m.type)).toEqual(['join', 'leave']);
    });

    test('an offer that appears under your thumb cannot be answered by accident', async () => {
      tapGuard.ms = 600;
      await open();
      await joinQueue();
      await say(offer());
      await press('Not now');
      await press("Don't match us again");
      await press("I'm ready");
      expect(sent().map((m) => m.type)).toEqual(['join']);
      await new Promise((r) => setTimeout(r, 650));
      await press("I'm ready");
      expect(sent()[sent().length - 1]).toMatchObject({ type: 'respond', answer: 'ready' });
    });
  });

  describe('your name', () => {
    test('renaming from the header reconnects under the new name', async () => {
      await open();
      await press(/Change your name/);
      const input = screen.getByLabelText('Your name');
      await fireEvent.changeText(input, '  Samira  ');
      await fireEvent(input, 'endEditing');
      await waitFor(() => expect(FakeSocket.latest.url).toContain('name=Samira'));
      expect(FakeSocket.all.length).toBe(2);
      expect(await screen.findByText('Hi, Samira')).toBeOnTheScreen();
    });
  });

  describe('connection', () => {
    test('a dropped connection while waiting is explained, then retried', async () => {
      await open();
      await joinQueue();
      await drop();
      expect(screen.getByText('Connection lost')).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Find a match' })).toBeDisabled();
      await waitFor(() => expect(FakeSocket.all.length).toBe(2), { timeout: 3000 });
      await connect();
      expect(screen.getByRole('button', { name: 'Find a match' })).toBeEnabled();
    });

    test('being opened on another device stops this one from fighting for the socket', async () => {
      await open();
      await say({ type: 'replaced' });
      await drop();
      expect(screen.getAllByText(/open on another device/i).length).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 700));
      expect(FakeSocket.all.length).toBe(1);
    });
  });
});
