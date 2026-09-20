import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    // برای اجرای آفلاین روی سرور، همه دارایی‌ها محلی بسته‌بندی می‌شوند
    assetsDir: "assets",
    chunkSizeWarningLimit: 1200,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // در حالت توسعه، درخواست‌های API به بک‌اند ارسال می‌شود
      "/api": { target: "http://127.0.0.1:8077", changeOrigin: true },
    },
  },
});
