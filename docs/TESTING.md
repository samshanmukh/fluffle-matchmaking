# Testing the app

All commands run from `mobile/`.

## In Node, as iOS and as Android

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` runs the same Jest suites twice, once with the iOS target and once with the Android target, and
writes `test-results/RESULTS.md` (every test with a column per platform) and `test-results/junit.xml`.
`npm run test:ios` and `npm run test:android` run one side only.

- `tests/app.test.tsx` renders the real app and plays the server's side through a fake WebSocket.
- `tests/session.test.ts` checks the reducer that mirrors the server's state.
- `tests/copy.test.ts` checks the wording rules.

These check behaviour and what is on screen, not pixels or haptics.

## On devices, against the real server

```bash
npm run test:devices
```

This drives the app in Expo Go on whichever iOS simulator and Android emulator are booted, with
[Maestro](https://maestro.dev), and writes `test-results/DEVICES.md`. `node scripts/e2e.mjs ios` or
`android` runs one side; a third argument filters flows by file-name prefix.

Before running it: the back end is on port 8080, `npx expo start` is on port 8081, Expo Go has opened the
project once on the device, and Maestro is installed (`brew install mobile-dev-inc/tap/maestro`, Java 17+;
the runner uses Android Studio's bundled Java when `JAVA_HOME` is not set).

The flows are in `e2e/flows/`. One that needs a second person starts with `# partner: ...`, and the runner
gives it a scripted one with a fresh identity.
