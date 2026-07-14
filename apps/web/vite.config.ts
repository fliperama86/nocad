import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => ({
  ...(mode === "research"
    ? {
        build: {
          rollupOptions: {
            input: {
              demo: "demo.html",
              fixture: "fixture.html",
              main: "index.html",
              northStar: "north-star.html"
            }
          }
        }
      }
    : {}),
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  server: {
    host: "127.0.0.1",
    port: 3000
  }
}));
