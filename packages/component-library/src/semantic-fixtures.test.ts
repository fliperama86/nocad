import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  createProjectSourceSet,
  parseProjectSourceJson,
  resolveProject,
  type Diagnostic,
  type EndpointRef,
  type ResolutionEnvironment
} from "@nocad/intent-core";
import { describe, expect, it } from "vitest";

import { loadBuiltInDefinitionCatalog } from "./catalog";

type SemanticExpectation = {
  diagnostics: Diagnostic[];
  generatedComponents: string[];
  project: string;
  schema: "nocad.semantic-fixture-expectation.v1";
  resolvedChoices: Array<{
    providerMode?: string;
    sourceEdge: string;
    strategy: "auto" | "manual";
  }>;
  signals: Array<
    | { endpoints: EndpointRef[]; signal: string }
    | { from: EndpointRef; signal: string; to: EndpointRef }
  >;
};

type SemanticManifest = {
  expectation: string;
  id: string;
  project: string;
  schema: "nocad.semantic-fixture-manifest.v1";
};

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const semanticFixturesRoot = path.join(repositoryRoot, "fixtures", "semantic");

describe("source-free semantic fixtures", () => {
  it("resolve deterministically against the production definition catalog", async () => {
    const catalog = await loadBuiltInDefinitionCatalog();
    const manifestPaths = await findNamedFiles(semanticFixturesRoot, "manifest.json");
    expect(manifestPaths.length).toBeGreaterThan(0);

    for (const manifestPath of manifestPaths.sort()) {
      const directory = path.dirname(manifestPath);
      const manifest = await readJson<SemanticManifest>(manifestPath);
      const source = parseProjectSourceJson(await readFile(path.join(directory, manifest.project), "utf8"));
      const expectation = await readJson<SemanticExpectation>(path.join(directory, manifest.expectation));
      expect(manifest.schema, manifestPath).toBe("nocad.semantic-fixture-manifest.v1");
      expect(source.id, manifestPath).toBe(manifest.id);
      expect(expectation.schema, manifestPath).toBe("nocad.semantic-fixture-expectation.v1");
      expect(expectation.project, manifestPath).toBe(source.id);

      for (const [name, version] of Object.entries(source.dependencies)) {
        expect(catalog.library.packages[name]?.version, `${manifest.id} dependency ${name}`).toBe(version);
      }
      for (const node of source.nodes) {
        if (node.kind === "component") {
          expect(catalog.components[node.component], `${manifest.id} component ${node.component}`).toBeDefined();
        } else if (node.kind === "intent.function") {
          expect(catalog.functions[node.function], `${manifest.id} function ${node.function}`).toBeDefined();
        }
      }

      const environment: ResolutionEnvironment = {
        catalog,
        resolveDependency(name, requestedVersion) {
          const packageDefinition = catalog.library.packages[name];
          return packageDefinition &&
            (requestedVersion === undefined || packageDefinition.version === requestedVersion)
            ? { hash: packageDefinition.contentHash, version: packageDefinition.version }
            : undefined;
        },
        sourceSet: createProjectSourceSet
      };
      const first = resolveProject(source, environment);
      const second = resolveProject(source, environment);

      expect(second, `${manifest.id} deterministic resolution`).toEqual(first);
      expect(first.diagnostics, `${manifest.id} diagnostics`).toEqual(expectation.diagnostics);
      expect(
        first.resolvedChoices.map(({ selected, sourceEdge, strategy }) => ({
          ...(selected.providerMode ? { providerMode: selected.providerMode } : {}),
          sourceEdge,
          strategy
        })),
        `${manifest.id} resolved choices`
      ).toEqual(expectation.resolvedChoices);
      expect(first.generated.map(({ id }) => id).sort(), `${manifest.id} generated components`).toEqual(
        [...expectation.generatedComponents].sort()
      );
      expect(
        first.nets
          .map(({ endpoints, sourceMap }) => ({
            endpoints: canonicalEndpoints(endpoints),
            signal: sourceMap.signal
          }))
          .sort(compareSignal),
        `${manifest.id} resolved signals`
      ).toEqual(
        expectation.signals
          .map((signal) => ({
            endpoints: canonicalEndpoints("endpoints" in signal ? signal.endpoints : [signal.from, signal.to]),
            signal: signal.signal
          }))
          .sort(compareSignal)
      );
    }
  });
});

async function findNamedFiles(directory: string, name: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return findNamedFiles(target, name);
        return entry.isFile() && entry.name === name ? [target] : [];
      })
    )
  ).flat();
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function compareSignal(left: { signal: string }, right: { signal: string }) {
  return left.signal.localeCompare(right.signal);
}

function canonicalEndpoints(endpoints: EndpointRef[]): EndpointRef[] {
  return [...endpoints].sort((left, right) =>
    left.node.localeCompare(right.node) ||
    (left.pin ?? "").localeCompare(right.pin ?? "") ||
    (left.port ?? "").localeCompare(right.port ?? "")
  );
}
