// One set of tests, run twice: once as iOS, once as Android. jest-expo resolves
// platform files (.ios / .android) and Platform.OS for each, so a difference
// between the two shows up as a failure in one column of the results.
const { getAndroidPreset, getIOSPreset } = require('jest-expo/config/getPlatformPreset');

const shared = {
  resolver: '<rootDir>/tests/support/resolver.js',
  setupFilesAfterEnv: ['<rootDir>/tests/support/setup.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.[jt]s?(x)'],
};

module.exports = {
  projects: [getIOSPreset(), getAndroidPreset()].map(({ passWithNoTests, watchPlugins, ...preset }) => ({ ...preset, ...shared })),
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'test-results', outputName: 'junit.xml', suiteNameTemplate: '{displayName} › {filepath}', classNameTemplate: '{displayName} › {classname}', titleTemplate: '{title}' }],
    '<rootDir>/tests/support/results-reporter.js',
  ],
};
