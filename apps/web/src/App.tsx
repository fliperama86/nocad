import { loadBuiltInDefinitionCatalog } from "@nocad/component-library";
import type { LoadedDefinitionCatalog } from "@nocad/component-library";
import { useEffect, useState } from "react";

import { CatalogWorkspaceApp } from "@/features/workspace/catalog-workspace-app";

type LibraryState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | {
      catalog: LoadedDefinitionCatalog;
      status: "ready";
    };

export function App() {
  const [library, setLibrary] = useState<LibraryState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void loadBuiltInDefinitionCatalog()
      .then((catalog) => {
        if (!cancelled) {
          setLibrary({
            catalog,
            status: "ready"
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLibrary({
            message: error instanceof Error ? error.message : "The definition library could not be loaded.",
            status: "error"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (library.status === "loading") {
    return <WorkspaceStatus message="Loading definition library..." />;
  }

  if (library.status === "error") {
    return <WorkspaceStatus message={library.message} tone="error" />;
  }

  return <CatalogWorkspaceApp catalog={library.catalog} />;
}

function WorkspaceStatus({ message, tone = "default" }: { message: string; tone?: "default" | "error" }) {
  return (
    <main className="grid h-svh place-items-center bg-background p-6 text-foreground">
      <div
        className={
          tone === "error"
            ? "rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            : "rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
        }
        role={tone === "error" ? "alert" : "status"}
      >
        {message}
      </div>
    </main>
  );
}
