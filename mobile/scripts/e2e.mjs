// Runs the Maestro flows in e2e/flows on a booted iOS simulator and/or Android
// emulator, against the real Rust back end, and writes test-results/DEVICES.md.
//
//   node scripts/e2e.mjs            # every booted device
//   node scripts/e2e.mjs ios        # or: android
//   node scripts/e2e.mjs ios 03     # only flows whose file name starts with 03
//
// Needs: the back end on :8080, `npx expo start` on :8081, Expo Go on the
// device with this project opened once, and Maestro (brew install mobile-dev-inc/tap/maestro).
//
// A flow whose first line is `# partner: <args>` gets a scripted second person
// (scripts/partner.mjs) for its duration, with a fresh identity every time so
// earlier blocks and cooldowns never leak into the next flow.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [only = 'all', filter = ''] = process.argv.slice(2);
const studioJava = '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const env = { ...process.env };
if (!env.JAVA_HOME && existsSync(studioJava)) env.JAVA_HOME = studioJava;
const sdk = env.ANDROID_HOME ?? join(env.HOME ?? '', 'Library/Android/sdk');
env.PATH = `${env.PATH}:${join(sdk, 'platform-tools')}`;

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

function devices() {
  const found = [];
  if (only === 'all' || only === 'ios') {
    try {
      const booted = Object.values(JSON.parse(sh('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])).devices).flat()[0];
      if (booted) found.push({ platform: 'iOS', id: booted.udid, name: booted.name, appId: 'host.exp.Exponent', url: 'exp://localhost:8081' });
    } catch {
      // no simulator tooling
    }
  }
  if (only === 'all' || only === 'android') {
    const line = sh('adb', ['devices']).split('\n').find((l) => /\tdevice$/.test(l));
    if (line) {
      const id = line.split('\t')[0];
      const name = sh('adb', ['-s', id, 'emu', 'avd', 'name']).split('\n')[0].trim() || id;
      // 10.0.2.2 is the emulator's name for this machine.
      found.push({ platform: 'Android', id, name, appId: 'host.exp.exponent', url: 'exp://10.0.2.2:8081' });
    }
  }
  return found;
}

async function up(url) {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

if (!(await up('http://localhost:8080/health'))) {
  console.error('The back end is not answering on :8080. Start it: (cd ../backend && cargo run --release)');
  process.exit(2);
}
if (!(await up('http://localhost:8081/status'))) {
  console.error('Metro is not answering on :8081. Start it: npx expo start');
  process.exit(2);
}
const targets = devices();
if (targets.length === 0) {
  console.error('No booted iOS simulator or Android emulator found.');
  process.exit(2);
}

const flows = readdirSync(join(root, 'e2e/flows')).filter((f) => f.endsWith('.yaml') && f.startsWith(filter)).sort();
const NAMES = ['Robin', 'Tariq', 'Mei', 'Paulo', 'Ines', 'Kwame', 'Sana', 'Dario'];
const results = []; // { flow, title, platform, device, ok, seconds, error }

for (const target of targets) {
  const out = join(root, 'test-results/devices', target.platform.toLowerCase());
  mkdirSync(out, { recursive: true });
  for (const [i, flow] of flows.entries()) {
    const text = readFileSync(join(root, 'e2e/flows', flow), 'utf8');
    const partnerArgs = text.match(/^# partner:(.*)$/m)?.[1].trim();
    const title = text.split('\n').find((l) => l.startsWith('# ') && !l.startsWith('# partner:'))?.slice(2) ?? flow;
    const partner = NAMES[i % NAMES.length];

    let bot;
    if (partnerArgs !== undefined) {
      bot = spawn(
        process.execPath,
        [join(root, 'scripts/partner.mjs'), '--name', partner, '--id', `e2e_${Date.now().toString(36)}`, ...partnerArgs.split(/\s+/).filter(Boolean)],
        { stdio: 'ignore' },
      );
    }

    process.stdout.write(`${target.platform.padEnd(8)} ${flow.padEnd(28)} `);
    const started = Date.now();
    const run = spawnSync(
      'maestro',
      ['--device', target.id, 'test', join(root, 'e2e/flows', flow), '-e', `APP_ID=${target.appId}`, '-e', `APP_URL=${target.url}`, '-e', `PARTNER=${partner}`, '--format', 'junit', '--output', join(out, `${flow.replace('.yaml', '')}.xml`)],
      { cwd: out, env, encoding: 'utf8' },
    );
    bot?.kill();
    const seconds = Math.round((Date.now() - started) / 1000);
    const ok = run.status === 0;
    const error = ok ? '' : ((run.stdout + run.stderr).split('\n').find((l) => /FAILED|Assertion|not found|Unable|Error/i.test(l)) ?? `exit ${run.status}`).trim();
    console.log(ok ? `pass  ${seconds}s` : `FAIL  ${seconds}s  ${error}`);
    if (!ok) writeFileSync(join(out, `${flow.replace('.yaml', '')}.log`), run.stdout + run.stderr);
    results.push({ flow, title, platform: target.platform, device: target.name, ok, seconds, error });
  }
}

// ---- report ---------------------------------------------------------------
const platforms = [...new Set(results.map((r) => r.platform))];
const maestro = sh('maestro', ['--version']).trim().split('\n').pop();
const cell = (flow, platform) => {
  const r = results.find((x) => x.flow === flow && x.platform === platform);
  return !r ? 'not run' : r.ok ? `pass (${r.seconds} s)` : `**FAIL**: ${r.error.replace(/\|/g, '\\|').slice(0, 120)}`;
};
const lines = [
  '# On-device test results',
  '',
  `Run at ${new Date().toISOString()} with \`npm run test:devices\`. Maestro ${maestro}, the app in Expo Go, against the real Rust back end.`,
  '',
  'Each flow drives the app on the device by its on-screen text. Flows that need a second person get a scripted one (`scripts/partner.mjs`) on the same server.',
  '',
  '| Platform | Device | Passed | Failed |',
  '|---|---|---|---|',
  ...platforms.map((p) => {
    const rs = results.filter((r) => r.platform === p);
    return `| ${p} | ${rs[0].device} | ${rs.filter((r) => r.ok).length} | ${rs.filter((r) => !r.ok).length} |`;
  }),
  '',
  `| Flow | What it checks | ${platforms.join(' | ')} |`,
  `|---|---|${platforms.map(() => '---').join('|')}|`,
  ...flows.map((f) => `| \`${f}\` | ${results.find((r) => r.flow === f)?.title ?? ''} | ${platforms.map((p) => cell(f, p)).join(' | ')} |`),
  '',
  'Screenshots taken during the flows are in `test-results/devices/<platform>/`.',
  '',
];
if (!filter) writeFileSync(join(root, 'test-results/DEVICES.md'), lines.join('\n'));
process.exit(results.every((r) => r.ok) ? 0 : 1);
