import Constants from 'expo-constants';

// Where the Rust back end lives.
//  * EXPO_PUBLIC_SERVER_URL wins (e.g. http://192.168.1.20:8080).
//  * Otherwise: the machine that serves the JS bundle, port 8080. That is
//    right for a simulator, an emulator and a phone on the same Wi-Fi alike.
function resolve(): string {
  const fromEnv = process.env.EXPO_PUBLIC_SERVER_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0] ?? 'localhost';
  return `http://${host}:8080`;
}

export const HTTP_URL = resolve();
export const WS_URL = HTTP_URL.replace(/^http/, 'ws');

export const MAX_LANGUAGES = 5;

// Ids are what the server matches on (it lower-cases them); labels come from copy.label().
export const LANGUAGES = [
  'english',
  'spanish',
  'hindi',
  'french',
  'portuguese',
  'german',
  'arabic',
  'mandarin',
  'japanese',
  'korean',
  'italian',
  'turkish',
];

export const TOPICS = ['politics', 'philosophy', 'sports', 'travel', 'food', 'music', 'movies', 'technology'];
