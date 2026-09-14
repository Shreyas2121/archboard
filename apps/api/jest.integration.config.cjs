const unitConfig = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...unitConfig,
  testMatch: ['<rootDir>/src/**/*.integration-spec.ts'],
  testPathIgnorePatterns: [],
};
