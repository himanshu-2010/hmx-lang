import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The parity harness (M5) reruns the native compiler's 358 test cases through
// the web compiler, and app.test.tsx smoke-tests the React shell. Tests run in
// Node via vitest; shared config with the app build so
// `web-playground/src/compiler` is testable without a DOM.
export default defineConfig({
  plugins: [react()],
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: ["web-playground/tests/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});