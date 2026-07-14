import type { LoadedDefinitionCatalog } from "@nocad/component-library";
import type { ProjectSource } from "@nocad/intent-core";
import type { XYPosition } from "@xyflow/react";
import { useMemo } from "react";

import {
  createCatalogNodeTemplates,
  createCatalogResolutionEnvironment
} from "./catalog-workspace";
import {
  ProjectWorkspaceApp,
  type WorkspaceProjectExample
} from "./project-workspace-app";

export function CatalogWorkspaceApp({
  allowProjectReplacement,
  catalog,
  examples,
  initialGraphFitView,
  initialPositions,
  initialPropertiesCollapsed,
  initialSource
}: {
  allowProjectReplacement?: boolean;
  catalog: LoadedDefinitionCatalog;
  examples?: WorkspaceProjectExample[];
  initialGraphFitView?: boolean;
  initialPositions?: Record<string, XYPosition>;
  initialPropertiesCollapsed?: boolean;
  initialSource?: ProjectSource;
}) {
  const environment = useMemo(() => createCatalogResolutionEnvironment(catalog), [catalog]);
  const nodeTemplates = useMemo(() => createCatalogNodeTemplates(catalog), [catalog]);

  return (
    <ProjectWorkspaceApp
      allowProjectReplacement={allowProjectReplacement}
      environment={environment}
      examples={examples}
      initialGraphFitView={initialGraphFitView}
      initialPositions={initialPositions}
      initialPropertiesCollapsed={initialPropertiesCollapsed}
      initialSource={initialSource}
      nodeTemplates={nodeTemplates}
    />
  );
}
