import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// R3F + TS の最小構成。test は vitest（model 層の純TSロジック検証用）。
// マルチページ: index.html（ゲーム本編）+ bgm.html（BGM 試聴室）。
// input はプロジェクトルートからの相対パス（node の path 型に依存しない）。
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        bgm: "bgm.html",
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
