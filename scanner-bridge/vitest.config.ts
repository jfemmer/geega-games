import { defineConfig } from "vitest/config";

// Explicit and self-contained so `npm test` here never picks up the main
// repo's root vitest.config.ts (its jsdom/browser-app setup doesn't apply
// to this plain-Node package) even though this folder lives inside it.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
