import { loadBuiltInDefinitionCatalog } from "@nocad/component-library";
import type {
  ComponentDescriptor,
  FunctionAuthoringDescriptor,
  LoadedDefinitionCatalog
} from "@nocad/component-library";
import {
  createProjectSourceSet,
  type ResolutionEnvironment
} from "@nocad/intent-core";
import { useEffect, useMemo, useState } from "react";

import {
  ProjectWorkspaceApp,
  type WorkspaceNodeTemplate
} from "@/features/workspace/project-workspace-app";

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

  return <LoadedWorkspace catalog={library.catalog} />;
}

function LoadedWorkspace({ catalog }: { catalog: LoadedDefinitionCatalog }) {
  const environment = useMemo<ResolutionEnvironment>(
    () => {
      const packages = new Map(
        Object.entries(catalog.library.packages).map(([name, descriptor]) => [
          name,
          {
            hash: descriptor.contentHash,
            version: descriptor.version
          }
        ])
      );

      return {
        catalog,
        resolveDependency(name, requestedVersion) {
          const dependency = packages.get(name);

          return dependency && (!requestedVersion || requestedVersion === dependency.version)
            ? dependency
            : undefined;
        },
        sourceSet: createProjectSourceSet
      };
    },
    [catalog]
  );
  const nodeTemplates = useMemo<WorkspaceNodeTemplate[]>(
    () => [
      ...catalog.library.componentDescriptors.map((descriptor) => ({
        dependency: {
          name: descriptor.package.name,
          version: descriptor.package.version
        },
        description: descriptorDescription(descriptor),
        id: descriptor.id,
        label: `${descriptor.manufacturer} ${descriptor.partNumber}`,
        node: {
          kind: "component" as const,
          component: descriptor.id,
          label: descriptor.partNumber,
          package: descriptor.devicePackage
        }
      })),
      ...catalog.library.functionDescriptors.map(functionTemplate)
    ],
    [catalog]
  );

  return <ProjectWorkspaceApp environment={environment} nodeTemplates={nodeTemplates} />;
}

function functionTemplate(descriptor: FunctionAuthoringDescriptor): WorkspaceNodeTemplate {
  return {
    dependency: {
      name: descriptor.package.name,
      version: descriptor.package.version
    },
    description: `Semantic function from ${descriptor.package.name}.`,
    id: `function:${descriptor.id}`,
    label: descriptor.label,
    node: {
      kind: "intent.function",
      function: descriptor.id,
      label: descriptor.label,
      ...(descriptor.defaultInclude ? { include: { ...descriptor.defaultInclude } } : {}),
      ...(descriptor.defaultRequirements ? { requirements: { ...descriptor.defaultRequirements } } : {})
    }
  };
}

function descriptorDescription(descriptor: ComponentDescriptor) {
  const coverage =
    descriptor.coverage === "complete"
      ? "Complete component definition."
      : "Interface definition, not package-complete.";

  return `${descriptor.description}. ${coverage}`;
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
