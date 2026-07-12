import { builtInComponentLibrary } from "@nocad/component-library";
import type { ComponentDescriptor } from "@nocad/component-library";
import type { DefinitionCatalog, ResolutionEnvironment } from "@nocad/intent-core";
import {
  createFixtureResolutionEnvironment,
  fixtureCatalog
} from "@nocad/intent-core/fixtures";
import { useEffect, useMemo, useState } from "react";

import { ProjectWorkspaceApp } from "../features/workspace/project-workspace-app";
import {
  createRealDirectVideoProject,
  createDemoNodeTemplates,
  createDemoProjectExamples
} from "./demo-catalog";

type DemoLibraryState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { catalog: DefinitionCatalog; descriptors: readonly ComponentDescriptor[]; status: "ready" };

export function DemoApp() {
  const [library, setLibrary] = useState<DemoLibraryState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void Promise.all([builtInComponentLibrary.list(), builtInComponentLibrary.loadDefinitions()])
      .then(([descriptors, components]) => {
        if (!cancelled) {
          setLibrary({
            catalog: {
              components,
              contracts: fixtureCatalog.contracts,
              functions: fixtureCatalog.functions
            },
            descriptors,
            status: "ready"
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLibrary({
            message: error instanceof Error ? error.message : "The demo component library could not be loaded.",
            status: "error"
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (library.status === "loading") {
    return <DemoStatus message="Loading demo component library..." />;
  }

  if (library.status === "error") {
    return <DemoStatus message={library.message} tone="error" />;
  }

  return <LoadedDemo catalog={library.catalog} descriptors={library.descriptors} />;
}

function LoadedDemo({
  catalog,
  descriptors
}: {
  catalog: DefinitionCatalog;
  descriptors: readonly ComponentDescriptor[];
}) {
  const environment = useMemo<ResolutionEnvironment>(
    () => {
      const fixtures = createFixtureResolutionEnvironment();
      const packages = new Map(
        descriptors.map((descriptor) => [
          descriptor.package.name,
          {
            hash: descriptor.package.contentHash,
            version: descriptor.package.version
          }
        ])
      );

      return {
        ...fixtures,
        catalog,
        resolveDependency(name, requestedVersion) {
          const dependency = packages.get(name);

          return dependency && (!requestedVersion || requestedVersion === dependency.version)
            ? dependency
            : fixtures.resolveDependency(name, requestedVersion);
        }
      };
    },
    [catalog, descriptors]
  );
  const nodeTemplates = useMemo(() => createDemoNodeTemplates(descriptors), [descriptors]);
  const examples = useMemo(() => createDemoProjectExamples(descriptors), [descriptors]);
  const initialSource = useMemo(() => createRealDirectVideoProject(descriptors), [descriptors]);

  return (
    <ProjectWorkspaceApp
      environment={environment}
      examples={examples}
      initialSource={initialSource}
      nodeTemplates={nodeTemplates}
    />
  );
}

function DemoStatus({ message, tone = "default" }: { message: string; tone?: "default" | "error" }) {
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
