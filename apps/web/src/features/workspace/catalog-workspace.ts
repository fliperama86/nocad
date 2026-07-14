import type { LoadedDefinitionCatalog } from "@nocad/component-library";
import { createProjectSourceSet, type ResolutionEnvironment } from "@nocad/intent-core";

import { componentTemplate, functionTemplate } from "../../catalog-templates";
import type { WorkspaceNodeTemplate } from "./project-workspace-app";

export function createCatalogNodeTemplates(
  catalog: LoadedDefinitionCatalog
): WorkspaceNodeTemplate[] {
  return [
    ...catalog.library.componentDescriptors.map(componentTemplate),
    ...catalog.library.functionDescriptors.map(functionTemplate)
  ];
}

export function createCatalogResolutionEnvironment(
  catalog: LoadedDefinitionCatalog
): ResolutionEnvironment {
  return {
    catalog,
    resolveDependency(name, requestedVersion) {
      const descriptor = catalog.library.packages[name];

      return descriptor && (!requestedVersion || requestedVersion === descriptor.version)
        ? { hash: descriptor.contentHash, version: descriptor.version }
        : undefined;
    },
    sourceSet: createProjectSourceSet
  };
}
