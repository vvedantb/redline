import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineWebViteConfig, srcAlias } from "@vvedantb/config";

export default defineConfig({
  ...defineWebViteConfig({
    tailwindcss,
    react: { plugin: react },
    alias: srcAlias(import.meta.dirname),
    dedupe: ["react", "react-dom"],
    vendorChunks: true,
  }),
});
