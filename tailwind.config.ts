// Tailwind v4 stub. This project configures Tailwind via @theme in
// src/styles.css — no JS config is required at runtime. We keep this
// near-empty file so tools that probe for tailwind.config.ts (e.g.
// lovable-tagger's esbuild scan) can resolve it instead of crashing the
// dev server, which previously left the Vite client entry unable to load.
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
};

export default config;
