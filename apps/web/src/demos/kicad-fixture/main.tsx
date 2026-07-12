import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "../../components/theme-provider";
import "../../style.css";
import { HdmiBreakoutFixturePanel } from "./hdmi-breakout-fixture-panel";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="nocad-theme">
      <main className="h-svh overflow-hidden bg-background p-3 text-foreground">
        <HdmiBreakoutFixturePanel />
      </main>
    </ThemeProvider>
  </StrictMode>
);
