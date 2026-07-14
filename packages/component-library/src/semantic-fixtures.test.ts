import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  createProjectSourceSet,
  parseProjectSourceJson,
  resolveProject,
  type Diagnostic,
  type EndpointRef,
  type NetRealizationRef,
  type ResolvedNet,
  type ResolutionEnvironment
} from "@nocad/intent-core";
import { describe, expect, it } from "vitest";

import { createCapturedPackageSource } from "./captured-package";
import { loadDefinitionCatalogForDependencies } from "./catalog";
import type {
  CapturedDefinitionPackageManifest,
  CapturedPackageDefinitionLoader
} from "./types";

type SemanticExpectation = {
  components: Array<{
    component: string;
    node: string;
    refdesHint?: string;
  }>;
  counts: {
    authoredComponents: number;
    authoredNets: number;
    resolvedNets: number;
  };
  diagnostics: Diagnostic[];
  generatedComponents: string[];
  nets: SemanticExpectedNet[];
  project: string;
  schema: "nocad.semantic-fixture-expectation.v2";
  resolvedChoices: Array<{
    providerMode?: string;
    sourceEdge: string;
    strategy: "auto" | "manual";
  }>;
};

type SemanticExpectedNet = {
  boardKind?: ResolvedNet["boardKind"];
  direction: ResolvedNet["direction"];
  endpoints: EndpointRef[];
  id: string;
  name: string;
  realizes?: NetRealizationRef;
  sourceEdge: string;
  sourceMap: ResolvedNet["sourceMap"];
};

type SemanticManifest = {
  definitionPackages: string[];
  expectation: string;
  id: string;
  project: string;
  schema: "nocad.semantic-fixture-manifest.v1";
};

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const semanticFixturesRoot = path.join(repositoryRoot, "fixtures", "semantic");

describe("source-free semantic fixtures", () => {
  it("resolve deterministically against explicit production and dependency-only definition packages", async () => {
    const manifestPaths = await findNamedFiles(semanticFixturesRoot, "manifest.json");
    expect(manifestPaths.length).toBeGreaterThan(0);

    for (const manifestPath of manifestPaths.sort()) {
      const directory = path.dirname(manifestPath);
      const manifest = await readJson<SemanticManifest>(manifestPath);
      const source = parseProjectSourceJson(await readFile(path.join(directory, manifest.project), "utf8"));
      const expectation = await readJson<SemanticExpectation>(path.join(directory, manifest.expectation));
      expect(manifest.schema, manifestPath).toBe("nocad.semantic-fixture-manifest.v1");
      expect(source.id, manifestPath).toBe(manifest.id);
      expect(expectation.schema, manifestPath).toBe("nocad.semantic-fixture-expectation.v2");
      expect(expectation.project, manifestPath).toBe(source.id);
      const packageSources = await Promise.all(manifest.definitionPackages.map(loadCapturedPackageSource));
      const catalog = await loadDefinitionCatalogForDependencies(source.dependencies, packageSources);

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
      const fixtureSourceSet = createProjectSourceSet(source);
      const environment: ResolutionEnvironment = {
        catalog,
        resolveDependency(name, requestedVersion) {
          const packageDefinition = catalog.library.packages[name];
          return packageDefinition &&
            (requestedVersion === undefined || packageDefinition.version === requestedVersion)
            ? { hash: packageDefinition.contentHash, version: packageDefinition.version }
            : undefined;
        },
        sourceSet: () => fixtureSourceSet
      };
      const [first, ...permuted] = representativeEdgeOrders(source.edges).map((edges) =>
        resolveProject({ ...source, edges }, environment)
      );
      if (!first) throw new Error(`${manifest.id} produced no deterministic resolution candidate`);

      for (const candidate of permuted) {
        expect(candidate, `${manifest.id} representative edge-order determinism`).toEqual(first);
      }
      expect(
        source.nodes
          .filter((node) => node.kind === "component")
          .map(({ component, id: node, refdesHint }) => ({
            component,
            node,
            ...(refdesHint ? { refdesHint } : {})
          }))
          .sort(compareNode),
        `${manifest.id} authored components`
      ).toEqual([...expectation.components].sort(compareNode));
      expect(source.nodes.filter((node) => node.kind === "component"), `${manifest.id} component count`).toHaveLength(
        expectation.counts.authoredComponents
      );
      expect(source.edges.filter((edge) => edge.kind === "net.authored"), `${manifest.id} authored net count`).toHaveLength(
        expectation.counts.authoredNets
      );
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
      expect(first.nets, `${manifest.id} resolved net count`).toHaveLength(expectation.counts.resolvedNets);
      expect(
        first.nets
          .map(comparableNet)
          .sort(compareNet),
        `${manifest.id} resolved physical nets`
      ).toEqual(
        expectation.nets
          .map((net) => ({ ...net, endpoints: canonicalEndpoints(net.endpoints) }))
          .sort(compareNet)
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

async function loadCapturedPackageSource(manifestPath: string) {
  const absoluteManifestPath = path.resolve(repositoryRoot, manifestPath);
  const packageRoot = path.dirname(absoluteManifestPath);
  const manifest = await readJson<CapturedDefinitionPackageManifest>(absoluteManifestPath);
  const definitionPaths = [
    ...manifest.components.map(({ definitionPath }) => definitionPath),
    ...(manifest.functions ?? []).map(({ definitionPath }) => definitionPath)
  ];
  const loaders = Object.fromEntries(
    definitionPaths.map((definitionPath) => [
      definitionPath,
      async () => ({ default: await readJson<unknown>(path.join(packageRoot, definitionPath)) })
    ])
  ) as Record<string, CapturedPackageDefinitionLoader>;
  return createCapturedPackageSource(manifest, loaders);
}

function comparableNet(net: ResolvedNet): SemanticExpectedNet {
  return {
    ...(net.boardKind ? { boardKind: net.boardKind } : {}),
    direction: net.direction,
    endpoints: canonicalEndpoints(net.endpoints),
    id: net.id,
    name: net.name,
    ...(net.realizes ? { realizes: net.realizes } : {}),
    sourceEdge: net.sourceEdge,
    sourceMap: net.sourceMap
  };
}

function compareNet(left: { id: string }, right: { id: string }) {
  return left.id.localeCompare(right.id);
}

function compareNode(left: { node: string }, right: { node: string }) {
  return left.node.localeCompare(right.node);
}

function canonicalEndpoints(endpoints: EndpointRef[]): EndpointRef[] {
  return [...endpoints].sort((left, right) =>
    left.node.localeCompare(right.node) ||
    (left.pin ?? "").localeCompare(right.pin ?? "") ||
    (left.port ?? "").localeCompare(right.port ?? "")
  );
}

function representativeEdgeOrders<T extends { id: string }>(edges: T[]): T[][] {
  const original = [...edges];
  const ascending = [...edges].sort((left, right) => left.id.localeCompare(right.id));
  const descending = [...ascending].reverse();
  const alternating = ascending.filter((_, index) => index % 2 === 0).concat(
    ascending.filter((_, index) => index % 2 === 1).reverse()
  );
  return [original, [...original].reverse(), ascending, descending, alternating];
}
