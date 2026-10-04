import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// base "./" damit die App unter https://<user>.github.io/<repo>/ läuft.
export default defineConfig({
  base: "./",
  plugins: [preact()],
  build: { target: "es2020", sourcemap: false },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
} as never);
