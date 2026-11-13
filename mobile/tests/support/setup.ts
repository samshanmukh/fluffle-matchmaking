/* eslint-disable @typescript-eslint/no-require-imports */
import { tapGuard } from '../../src/useTapGuard';
import { FakeSocket } from './fakeServer';

// Native pieces that have nothing to say in a Node test run.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'US', languageCode: 'en' }] }));
jest.mock('expo-blur', () => ({ BlurView: require('react-native').View }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@expo-google-fonts/outfit', () => ({
  useFonts: () => [true, null],
  Outfit_400Regular: 1,
  Outfit_500Medium: 2,
  Outfit_600SemiBold: 3,
}));

require('react-native-reanimated').setUpTests();

beforeEach(() => {
  tapGuard.ms = 0; // tests press the moment a screen appears; the guard has its own tests
  FakeSocket.reset();
  (globalThis as { WebSocket: unknown }).WebSocket = FakeSocket;
});
