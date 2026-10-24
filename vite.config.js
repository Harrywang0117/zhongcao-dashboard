import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // public/ 由 server.mjs 在生产里兜底提供，但 dev server 必须也能发
  // mascot.svg / icon.svg / manifest，否则 npm run dev 看到的是碎图。
  // build 时一并拷进 dist，server.mjs 先查 dist 再查 public，内容一致。
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
