import { components, contracts, functions, packageVersions } from "./fixtures";
import { resolveProject } from "./resolver";
import type { DefinitionCatalog, ProjectSource, ResolutionEnvironment, ResolvedDependency } from "./types";

export const fixtureCatalog: DefinitionCatalog = {
  components,
  contracts,
  functions
};

export function createFixtureResolutionEnvironment(): ResolutionEnvironment {
  return {
    catalog: fixtureCatalog,
    resolveDependency(name, requestedVersion) {
      const availableVersion = packageVersions[name];

      if (!availableVersion || (requestedVersion !== undefined && requestedVersion !== availableVersion)) {
        return undefined;
      }

      return fixtureDependency(name, availableVersion);
    },
    sourceSet(currentSource) {
      return {
        hash: `fixture-source:${currentSource.id}`,
        files: [
          {
            role: "project",
            path: `fixtures/${currentSource.id}.nocad.json`,
            hash: `fixture-project:${currentSource.id}`
          }
        ]
      };
    }
  };
}

export function resolveFixtureProject(source: ProjectSource) {
  return resolveProject(source, createFixtureResolutionEnvironment());
}

function fixtureDependency(name: string, version: string): ResolvedDependency {
  return {
    hash: `fixture-package:${name}@${version}`,
    version
  };
}
