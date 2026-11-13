// Reanimated ships a Jest resolver that swaps a few of its native-only files
// for their JS versions. React Native's preset has a resolver of its own, so
// this chains them: Reanimated's rules first, React Native's for everything else.
const reactNativeResolver = require('@react-native/jest-preset/jest/resolver.js');
const reanimatedResolver = require('react-native-reanimated/jest/resolver');

module.exports = (request, options) =>
  reanimatedResolver(request, {
    ...options,
    defaultResolver: (req, opts) => reactNativeResolver(req, { ...opts, defaultResolver: options.defaultResolver }),
  });
