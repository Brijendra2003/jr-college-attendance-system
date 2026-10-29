import { defineConfig } from 'vitest/config';

// Unit tests only. The database suite (supabase/tests) runs separately with `npm run test:db`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
