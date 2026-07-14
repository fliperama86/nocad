import type { LoadedDefinitionCatalog } from "@nocad/component-library";
import { useEffect, useState } from "react";

import { CatalogWorkspaceApp } from "../features/workspace/catalog-workspace-app";
import {
  loadWorkspaceFixtureCatalog,
  type WorkspaceFixture
} from "./workspace-fixture";

type FixtureCatalogState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { catalog: LoadedDefinitionCatalog; status: "ready" };

export function WorkspaceFixtureApp({ fixture }: { fixture: WorkspaceFixture }) {
  const [catalogState, setCatalogState] = useState<FixtureCatalogState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void loadWorkspaceFixtureCatalog(fixture)
      .then((catalog) => {
        if (!cancelled) setCatalogState({ catalog, status: "ready" });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalogState({
            message: error instanceof Error ? error.message : "The fixture catalog could not be loaded.",
            status: "error"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fixture]);

  return (
    <div className="grid h-svh min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <FixtureHeader fixture={fixture} />
      <div className="min-h-0">
        {catalogState.status === "ready" ? (
          <CatalogWorkspaceApp
            allowProjectReplacement={false}
            catalog={catalogState.catalog}
            initialGraphFitView
            initialPositions={{ ...fixture.positions }}
            initialPropertiesCollapsed
            initialSource={fixture.source}
          />
        ) : (
          <FixtureStatus
            message={
              catalogState.status === "error"
                ? catalogState.message
                : "Loading fixture definition packages..."
            }
            tone={catalogState.status === "error" ? "error" : "default"}
          />
        )}
      </div>
    </div>
  );
}

function FixtureHeader({ fixture }: { fixture: WorkspaceFixture }) {
  const status = fixture.status;
  const badges = [
    status.sourceFree ? "source-free" : "source-backed",
    status.exactPhysicalParity ? "physical parity" : "topology slice",
    status.golden ? "golden" : "non-golden",
    status.hardwareQualified ? "hardware-qualified" : "not hardware-qualified",
    `license ${status.license}`
  ];

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold">{fixture.source.name}</h1>
        <p className="text-xs text-muted-foreground">
          Fixture baseline: {formatScope(status.scope)}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-1.5">
        {badges.map((badge) => (
          <span
            className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
            key={badge}
          >
            {badge}
          </span>
        ))}
      </div>
    </header>
  );
}

function FixtureStatus({
  message,
  tone
}: {
  message: string;
  tone: "default" | "error";
}) {
  return (
    <div className="grid h-full place-items-center p-6">
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
    </div>
  );
}

function formatScope(scope: string) {
  return scope.replaceAll("-", " ");
}
