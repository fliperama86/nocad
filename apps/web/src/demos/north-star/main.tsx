import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ThemeProvider } from "../../components/theme-provider";
import "../../style.css";
import { WorkspaceFixtureApp } from "../workspace-fixture-app";
import { fixture } from "./fixture";

const rootElement = document.getElementById("root");

if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="nocad-theme">
      <WorkspaceFixtureApp fixture={fixture} />
    </ThemeProvider>
  </StrictMode>
);
