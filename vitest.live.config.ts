import { defineConfig } from 'vitest/config';

// Live tests call the real Groq API through the Worker code. Run on purpose only:
//   npx vitest run --config vitest.live.config.ts
// Needs worker/.dev.vars with GROQ_API_KEY (git-ignored). Never runs in CI.
export default defineConfig({
  test: { include: ['tests/live/**/*.live.ts'], environment: 'node', testTimeout: 60_000 },
});
