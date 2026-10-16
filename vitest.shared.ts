// Common vitest options for every package (generous timeouts: the suites run on a shared, often loaded box).
export const sharedTest = {
  environment: "jsdom",
  testTimeout: 30000,
  hookTimeout: 30000,
} as const;
