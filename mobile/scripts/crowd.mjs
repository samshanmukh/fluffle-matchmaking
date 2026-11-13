// Fills the server with scripted people, so the app's "Active now" list has
// someone in it when you are trying things alone.
//
//   node scripts/crowd.mjs                # 12 people
//   node scripts/crowd.mjs --server ws://192.168.1.20:8080
//
// These are real connections, not data baked into the app: stop the script
// and they go offline. Half of them wait in the queue, each in a different
// language so they never pair with each other; pick one of those languages in
// the app and you are matched with that person, who says ready after a moment
// and rejoins when the call ends. The other half are only online.
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const server = args.server ?? 'ws://localhost:8080';

const PEOPLE = [
  { name: 'Yuki', region: 'JP', language: 'japanese', topic: 'food' },
  { name: 'Rafa', region: 'BR', language: 'portuguese', topic: 'sports' },
  { name: 'Amara', region: 'NG', language: 'english', topic: 'music' },
  { name: 'Lena', region: 'DE', language: 'german', topic: 'philosophy' },
  { name: 'Priya', region: 'IN', language: 'hindi', topic: 'movies' },
  { name: 'Sofia', region: 'MX', language: 'spanish', topic: 'travel' },
  { name: 'Camille', region: 'FR' },
  { name: 'Min-jun', region: 'KR' },
  { name: 'Omar', region: 'EG' },
  { name: 'Elif', region: 'TR' },
  { name: 'Tom', region: 'GB' },
  { name: 'Wei', region: 'CN' },
];

function connect(person) {
  const id = `crowd_${person.name.toLowerCase()}`;
  const ws = new WebSocket(`${server}/ws?user_id=${id}&name=${encodeURIComponent(person.name)}&region=${person.region}`);
  const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));
  const join = () => person.language && send({ type: 'join', languages: [person.language], topic: person.topic ?? null });
  let ping;

  ws.onopen = () => {
    ping = setInterval(() => send({ type: 'ping' }), 10_000);
  };
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'hello') join();
    if (msg.type === 'offer') {
      console.log(`${person.name} was matched with ${msg.partner_name}`);
      setTimeout(() => send({ type: 'respond', match_id: msg.match_id, answer: 'ready', never_again: false }), 2000);
    }
    // Back in the queue after a call, a skipped offer or a long wait.
    if (msg.type === 'left' || msg.type === 'call_ended') setTimeout(join, 3000);
  };
  ws.onclose = () => {
    clearInterval(ping);
    setTimeout(() => connect(person), 2000); // the server restarted: come back
  };
  ws.onerror = () => {};
}

PEOPLE.forEach(connect);
const waiting = PEOPLE.filter((p) => p.language);
console.log(`${PEOPLE.length} people online at ${server}.`);
console.log(`Waiting: ${waiting.map((p) => `${p.name} (${p.language})`).join(', ')}.`);
console.log('Press Ctrl+C to take them offline.');
