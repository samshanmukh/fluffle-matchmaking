// A scripted second person, for trying the app with one simulator.
//
//   node scripts/partner.mjs                       # joins with English, says ready
//   node scripts/partner.mjs --answer decline      # ready | decline | never | silent
//   node scripts/partner.mjs --languages english,spanish --topic politics --name Bea
//
// It talks to the same WebSocket the app does and prints every message.
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const server = args.server ?? 'ws://localhost:8080';
const name = args.name ?? 'Bea';
const id = args.id ?? `bot_${name.toLowerCase()}`;
const languages = (args.languages ?? 'english').split(',');
const topic = args.topic ?? null;
const answer = args.answer ?? 'ready';
const delay = Number(args.delay ?? 2000);

const ws = new WebSocket(`${server}/ws?user_id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`);
const send = (msg) => ws.send(JSON.stringify(msg));
ws.onopen = () => setInterval(() => send({ type: 'ping' }), 10_000);
ws.onerror = () => console.error(`could not reach ${server}`);
ws.onclose = () => process.exit(0);
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'pong') return;
  console.log(new Date().toISOString().slice(11, 19), JSON.stringify(msg));
  if (msg.type === 'hello') send({ type: 'join', languages, topic });
  if (msg.type === 'offer' && answer !== 'silent') {
    setTimeout(
      () =>
        send({
          type: 'respond',
          match_id: msg.match_id,
          answer: answer === 'ready' ? 'ready' : 'decline',
          never_again: answer === 'never',
        }),
      delay,
    );
  }
  if (msg.type === 'left' || msg.type === 'call_ended') ws.close();
};
