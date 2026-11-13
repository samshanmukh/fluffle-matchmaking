// Writes test-results/RESULTS.md and results.json: every test, side by side for iOS and Android.
const fs = require('node:fs');
const path = require('node:path');

class ResultsReporter {
  constructor(globalConfig) {
    this.rootDir = globalConfig.rootDir;
  }

  onRunComplete(_contexts, run) {
    const platforms = [];
    const rows = new Map(); // "file › suite › test" -> { platform: {status, ms} }
    for (const file of run.testResults) {
      const platform = file.displayName?.name ?? 'default';
      if (!platforms.includes(platform)) platforms.push(platform);
      const rel = path.relative(this.rootDir, file.testFilePath);
      if (file.testExecError) {
        rows.set(`${rel} › (file failed to run)`, { ...(rows.get(`${rel} › (file failed to run)`) ?? {}), [platform]: { status: 'failed', ms: 0 } });
      }
      for (const t of file.testResults) {
        const key = [rel, ...t.ancestorTitles, t.title].join(' › ');
        rows.set(key, { ...(rows.get(key) ?? {}), [platform]: { status: t.status, ms: t.duration ?? 0 } });
      }
    }
    platforms.sort();

    const totals = Object.fromEntries(platforms.map((p) => [p, { passed: 0, failed: 0, skipped: 0 }]));
    for (const cells of rows.values()) {
      for (const p of platforms) {
        const s = cells[p]?.status;
        if (s === 'passed') totals[p].passed++;
        else if (s === 'failed') totals[p].failed++;
        else totals[p].skipped++;
      }
    }

    const mark = (cell) => (!cell ? 'not run' : cell.status === 'passed' ? `pass (${cell.ms} ms)` : cell.status === 'failed' ? '**FAIL**' : cell.status);
    const lines = [
      '# Test results',
      '',
      `Run at ${new Date(run.startTime).toISOString()} with \`npm test\`. Jest ${require('jest/package.json').version}, jest-expo ${require('jest-expo/package.json').version}, Node ${process.version}.`,
      '',
      'These suites render the real app and drive it through a scripted server, once with the iOS target and once with the Android target. They run in Node, not on a device: they check behaviour and what is on screen, not pixels, native blur or haptics.',
      '',
      '| Platform | Passed | Failed | Skipped |',
      '|---|---|---|---|',
      ...platforms.map((p) => `| ${p} | ${totals[p].passed} | ${totals[p].failed} | ${totals[p].skipped} |`),
      '',
    ];
    let currentFile = '';
    for (const [key, cells] of [...rows.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const [file, ...rest] = key.split(' › ');
      if (file !== currentFile) {
        currentFile = file;
        lines.push('', `## ${file}`, '', `| Test | ${platforms.join(' | ')} |`, `|---|${platforms.map(() => '---').join('|')}|`);
      }
      lines.push(`| ${rest.join(' › ').replace(/\|/g, '\\|')} | ${platforms.map((p) => mark(cells[p])).join(' | ')} |`);
    }

    const out = path.join(this.rootDir, 'test-results');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'RESULTS.md'), `${lines.join('\n')}\n`);
    fs.writeFileSync(
      path.join(out, 'results.json'),
      `${JSON.stringify({ startedAt: new Date(run.startTime).toISOString(), totals, tests: Object.fromEntries(rows) }, null, 2)}\n`,
    );
  }
}

module.exports = ResultsReporter;
