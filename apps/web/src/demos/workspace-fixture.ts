import {
  loadDefinitionCatalogForDependencies,
  type CapturedDefinitionPackageSource,
  type LoadedDefinitionCatalog
} from "@nocad/component-library";
import { parseProjectSourceJson, type ProjectSource } from "@nocad/intent-core";
import type { XYPosition } from "@xyflow/react";

type UnknownRecord = Record<string, unknown>;

export type WorkspaceFixture = {
  packageSources: readonly CapturedDefinitionPackageSource[];
  positions: Readonly<Record<string, XYPosition>>;
  source: ProjectSource;
  status: {
    exactPhysicalParity: boolean;
    golden: boolean;
    hardwareQualified: boolean;
    license: string;
    scope: string;
    sourceFree: boolean;
  };
};

export function createWorkspaceFixture({
  manifestValue,
  packageSources,
  positionsValue,
  projectJson
}: {
  manifestValue: unknown;
  packageSources: readonly CapturedDefinitionPackageSource[];
  positionsValue: unknown;
  projectJson: string;
}): WorkspaceFixture {
  const source = parseProjectSourceJson(projectJson);
  const manifest = record(manifestValue, "fixture manifest");
  if (manifest.id !== source.id) {
    throw new Error("The workspace fixture manifest and project must have the same id.");
  }

  const status = record(manifest.status, "fixture manifest status");
  const provenance = record(manifest.provenance, "fixture manifest provenance");
  const nodeIds = new Set(source.nodes.map(({ id }) => id));
  const positions = Object.fromEntries(
    Object.entries(record(positionsValue, "fixture positions")).map(([nodeId, value]) => {
      if (!nodeIds.has(nodeId)) {
        throw new Error(`Fixture position refers to unknown node ${nodeId}.`);
      }
      const position = record(value, `fixture position ${nodeId}`);
      return [
        nodeId,
        {
          x: finiteNumber(position.x, `fixture position ${nodeId}.x`),
          y: finiteNumber(position.y, `fixture position ${nodeId}.y`)
        }
      ];
    })
  );

  return {
    packageSources: [...packageSources],
    positions,
    source,
    status: {
      exactPhysicalParity: boolean(status.exactPhysicalParity, "status.exactPhysicalParity"),
      golden: boolean(status.golden, "status.golden"),
      hardwareQualified: boolean(status.hardwareQualified, "status.hardwareQualified"),
      license: text(status.license, "status.license"),
      scope: text(status.scope, "status.scope"),
      sourceFree: boolean(provenance.sourceFree, "provenance.sourceFree")
    }
  };
}

export function loadWorkspaceFixtureCatalog(
  fixture: WorkspaceFixture
): Promise<LoadedDefinitionCatalog> {
  return loadDefinitionCatalogForDependencies(fixture.source.dependencies, fixture.packageSources);
}

function record(value: unknown, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as UnknownRecord;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}
