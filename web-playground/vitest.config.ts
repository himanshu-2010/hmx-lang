import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The parity harness (M5) reruns the native compiler's 358 test cases through
// the web compiler. Tests run in Node via vitest; shared config with the app
// build so `src/compiler` is testable without a DOM.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});