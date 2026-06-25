import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site at /<repo>/. The base path must match the
// repository name so that built asset URLs resolve correctly.
// Override with VITE_BASE if deploying elsewhere (e.g. a custom domain → "/").
const base = process.env.VITE_BASE ?? "/ipade-companion/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
