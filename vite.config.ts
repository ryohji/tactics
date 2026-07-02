import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// R3F + TS の最小構成。test は vitest（model 層の純TSロジック検証用）。
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
