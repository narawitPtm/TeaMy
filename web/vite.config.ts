import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies API + WebSocket to the Phase 4 engine server on :4000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/state": "http://localhost:4000",
      "/history": "http://localhost:4000",
      "/floors": "http://localhost:4000",
      "/command": "http://localhost:4000",
      "/tasks": "http://localhost:4000",
      "/approve": "http://localhost:4000",
      "/settings": "http://localhost:4000",
      "/events": { target: "ws://localhost:4000", ws: true },
    },
  },
});
