module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/engine'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
