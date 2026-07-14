import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadBuiltInDefinitionCatalog,
  loadDefinitionCatalogForDependencies
} from "./catalog";
import {
  createCapturedPackageSource,
  InvalidCapturedDefinitionPackageError,
  validateCapturedDefinitionPackageManifest
} from "./captured-package";
import { validateComponentDescriptor } from "./descriptor";
import { DefinitionIntegrityError } from "./integrity";
import { validateComponentDefinition } from "./validation";
import type {
  CapturedDefinitionPackageManifest,
  CapturedDefinitionPackageSource,
  CapturedPackageDefinitionLoader
} from "./types";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const referenceRoot = path.join(
  repositoryRoot,
  "references/north-star/pico-retrodigital-main"
);
const packageRoot = path.join(
  repositoryRoot,
  "fixtures/definition-packages/pico-retrodigital-main/captured-instances"
);
const packageName = "reference:pico-retrodigital-main/captured-instances";
const packageVersion = "0.1.0";
const functionId = "reference:pico-retrodigital-main:video_output.v1";

describe("captured definition packages", () => {
  it("loads the pinned R3-R10 package with UUID identities and exact normalized capture facts", async () => {
    const { manifest, source } = await loadReferencePackage();
    const inventory = await readJson<{ components: InventoryComponent[] }>(
      path.join(referenceRoot, "inventory.json")
    );

    expect(manifest.package).toEqual({
      contentHash: "sha256:08a8d951cbac9183f93a3a3411754a9f147d838373cb9e1858243dd8f57dbb36",
      name: packageName,
      version: packageVersion
    });
    expect(source.componentDescriptors).toHaveLength(8);
    expect(source.functionDescriptors.map(({ id }) => id)).toEqual([functionId]);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.componentDescriptors[0]?.capture)).toBe(true);

    for (const descriptor of source.componentDescriptors) {
      const captured = inventory.components.find(
        ({ schematicUuid }) => schematicUuid === descriptor.sourceIdentity.uuid
      );
      expect(captured).toBeDefined();
      expect(descriptor.id).toBe(`reference:pico-retrodigital-main:${captured!.schematicUuid}`);
      expect(descriptor).toMatchObject({
        capture: {
          boardFootprint: {
            pads: captured!.boardFootprints[0]!.pins.map(({ number, uuid }) => ({ number, uuid })),
            uuid: captured!.boardFootprints[0]!.uuid
          },
          footprintLibraryIdAtCapture: captured!.footprintFieldAtCapture,
          referenceAtCapture: captured!.referenceAtCapture,
          symbolLibraryIdAtCapture: captured!.libraryId,
          valueAtCapture: captured!.valueAtCapture
        },
        coverage: "interface",
        origin: "captured-instance",
        sourceIdentity: {
          kind: "kicad-schematic-symbol",
          referenceId: "pico-retrodigital-main",
          uuid: captured!.schematicUuid
        },
        visibility: "dependency-only"
      });
      expect(descriptor.provenance.length).toBeGreaterThan(0);
      await expect(source.load("component", descriptor.id)).resolves.toMatchObject({
        id: descriptor.id,
        pins: {
          "1": { capabilities: ["passive.terminal"] },
          "2": { capabilities: ["passive.terminal"] }
        },
        properties: { resistance: { unit: "ohm", value: 220 } }
      });
    }

    expect(source.componentDescriptors.map(({ capture }) => capture.referenceAtCapture)).toEqual([
      "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"
    ]);
  });

  it("pins every declared evidence artifact to its repository-local content", async () => {
    const { manifest } = await loadReferencePackage();

    for (const evidence of manifest.evidence) {
      const content = await readFile(path.join(repositoryRoot, evidence.path));
      expect(`sha256:${createHash("sha256").update(content).digest("hex")}`).toBe(evidence.sha256);
    }
  });

  it("defines eight exact per-signal series rules without inventing qualification facts", async () => {
    const { source } = await loadReferencePackage();
    const definition = await source.load("function", functionId) as {
      include: Record<string, unknown>;
      signalGroups: Array<{ id: string; signals: Array<{ id: string }> }>;
      topology: { inlineRules: CapturedInlineRule[] };
    };
    const expected = [
      ["R3", "tmds0_n"],
      ["R4", "clock_n"],
      ["R5", "clock_p"],
      ["R6", "tmds0_p"],
      ["R7", "tmds1_n"],
      ["R8", "tmds1_p"],
      ["R9", "tmds2_n"],
      ["R10", "tmds2_p"]
    ];

    expect(definition.include.seriesTermination).toEqual({
      fields: {
        mode: {
          default: "required",
          kind: "enum",
          label: "Mode",
          options: [
            { label: "Off", value: "off" },
            { label: "Required", value: "required" }
          ]
        },
        value: { default: "220ohm", kind: "resistance", label: "Value" }
      },
      kind: "object",
      label: "Series termination"
    });
    expect(definition.topology.inlineRules).toHaveLength(8);

    for (const [reference, signal] of expected) {
      const rule = definition.topology.inlineRules.find(({ id }) => id === `seriesTermination${reference}`);
      const descriptor = source.componentDescriptors.find(
        ({ capture }) => capture.referenceAtCapture === reference
      );
      expect(rule).toMatchObject({
        component: descriptor?.id,
        dependency: packageName,
        enabledWhen: { field: "mode", values: ["required"] },
        include: "seriesTermination",
        pins: { connector: "2", provider: "1" },
        signals: { group: `seriesTermination${reference}Signal` },
        value: { default: "220ohm", includeField: "value" }
      });
      expect(
        definition.signalGroups.find(({ id }) => id === `seriesTermination${reference}Signal`)?.signals
      ).toEqual([expect.objectContaining({ id: signal })]);
    }

    for (const descriptor of source.componentDescriptors) {
      expect("manufacturer" in descriptor).toBe(false);
      expect("partNumber" in descriptor).toBe(false);
    }
  });

  it("gates captured payloads by an exact explicit dependency while preserving builtin definitions", async () => {
    const { source } = await loadReferencePackage();
    const builtIn = await loadBuiltInDefinitionCatalog();
    const absent = await loadDefinitionCatalogForDependencies({}, [source]);
    const wrongVersion = await loadDefinitionCatalogForDependencies(
      { [packageName]: "9.9.9" },
      [source]
    );
    const selected = await loadDefinitionCatalogForDependencies(
      { [packageName]: packageVersion },
      [source]
    );

    expect(absent).toBe(builtIn);
    expect(wrongVersion).toBe(builtIn);
    expect(absent.contracts["builtin:i2c.v1"]).toBeDefined();
    expect(absent.library.packages.builtin).toBeDefined();
    expect(absent.library.capturedComponentDescriptors).toEqual([]);
    expect(absent.components[source.componentDescriptors[0]!.id]).toBeUndefined();
    expect(absent.functions[functionId]).toBeUndefined();

    expect(selected.library.packages[packageName]).toEqual(source.package);
    expect(selected.library.capturedComponentDescriptors).toEqual(source.componentDescriptors);
    expect(selected.library.capturedFunctionDescriptors).toEqual(source.functionDescriptors);
    expect(selected.components[source.componentDescriptors[0]!.id]).toBeDefined();
    expect(selected.functions[functionId]?.dependency).toEqual({
      name: packageName,
      version: packageVersion
    });
    expect(selected.contracts["builtin:i2c.v1"]).toBeDefined();
    expect(selected.library.componentDescriptors).toBe(builtIn.library.componentDescriptors);
    expect(selected.library.functionDescriptors).toBe(builtIn.library.functionDescriptors);
  });

  it("keeps captured definitions out of production descriptor validation and palette arrays", async () => {
    const { source } = await loadReferencePackage();
    const catalog = await loadDefinitionCatalogForDependencies(
      { [packageName]: packageVersion },
      [source]
    );

    expect(() => validateComponentDescriptor(source.componentDescriptors[0])).toThrow(
      /manufacturer must be a non-empty trimmed string/
    );
    expect(catalog.library.componentDescriptors.some(({ id }) => id.startsWith("reference:"))).toBe(false);
    expect(catalog.library.functionDescriptors.some(({ id }) => id.startsWith("reference:"))).toBe(false);
  });

  it("rejects unsafe captured metadata, invalid closure hashes, and incomplete loader maps", async () => {
    const { loaders, rawManifest } = await readReferencePackageInputs();
    const invalidOrigin = structuredClone(rawManifest);
    invalidOrigin.components[0]!.origin = "production" as "captured-instance";
    expect(() => validateCapturedDefinitionPackageManifest(invalidOrigin)).toThrow(
      InvalidCapturedDefinitionPackageError
    );

    const paletteVisible = structuredClone(rawManifest);
    paletteVisible.components[0]!.visibility = "palette" as "dependency-only";
    expect(() => validateCapturedDefinitionPackageManifest(paletteVisible)).toThrow(
      /visibility must be dependency-only/
    );

    const refdesKeyed = structuredClone(rawManifest);
    refdesKeyed.components[0]!.id = "reference:pico-retrodigital-main:R3";
    expect(() => validateCapturedDefinitionPackageManifest(refdesKeyed)).toThrow(
      /id must be keyed by its source UUID/
    );

    const missingProvenance = structuredClone(rawManifest);
    missingProvenance.components[0]!.provenance = [];
    expect(() => validateCapturedDefinitionPackageManifest(missingProvenance)).toThrow(
      /provenance must not be empty/
    );

    const invalidClosure = structuredClone(rawManifest);
    invalidClosure.package.contentHash = `sha256:${"0".repeat(64)}`;
    expect(() => validateCapturedDefinitionPackageManifest(invalidClosure)).toThrow(
      /package expected content/
    );

    const traversalPath = structuredClone(rawManifest);
    traversalPath.components[0]!.definitionPath = "../outside.json";
    expect(() => validateCapturedDefinitionPackageManifest(traversalPath)).toThrow(
      /definitionPath must be a normalized package-relative POSIX path/
    );

    const duplicatePath = structuredClone(rawManifest);
    duplicatePath.components[1]!.definitionPath = duplicatePath.components[0]!.definitionPath;
    expect(() => validateCapturedDefinitionPackageManifest(duplicatePath)).toThrow(
      /definition paths must be unique/
    );

    for (const unsafeEvidencePath of [
      "references\\north-star\\inventory.json",
      "C:/references/inventory.json",
      "references/./inventory.json"
    ]) {
      const unsafeEvidence = structuredClone(rawManifest);
      unsafeEvidence.evidence[0]!.path = unsafeEvidencePath;
      expect(() => validateCapturedDefinitionPackageManifest(unsafeEvidence)).toThrow(
        /evidence\[0\]\.path must be a normalized repository-relative POSIX path/
      );
    }

    const [firstPath] = Object.keys(loaders);
    const missingLoader = { ...loaders };
    delete missingLoader[firstPath!];
    expect(() => createCapturedPackageSource(rawManifest, missingLoader)).toThrow(/missing payload loader/);
    expect(() => createCapturedPackageSource(rawManifest, {
      ...loaders,
      "definitions/unexpected.json": async () => ({ default: {} })
    })).toThrow(/unexpected payload loader/);
  });

  it("verifies selected payload content and rejects duplicate selected package sources", async () => {
    const { loaders, rawManifest, source } = await loadReferencePackage();
    const firstDefinitionPath = rawManifest.components[0]!.definitionPath;
    const tampered = createCapturedPackageSource(rawManifest, {
      ...loaders,
      [firstDefinitionPath]: async () => ({
        default: {
          ...(await loaders[firstDefinitionPath]!()).default as Record<string, unknown>,
          properties: { resistance: { unit: "ohm", value: 221 } }
        }
      })
    });

    await expect(
      loadDefinitionCatalogForDependencies({ [packageName]: packageVersion }, [tampered])
    ).rejects.toBeInstanceOf(DefinitionIntegrityError);
    await expect(
      loadDefinitionCatalogForDependencies({ [packageName]: packageVersion }, [source, source])
    ).rejects.toThrow(/duplicate package source/);
  });

  it("snapshots payload loaders when creating an immutable package source", async () => {
    const { loaders, rawManifest } = await readReferencePackageInputs();
    const mutableLoaders = { ...loaders };
    const first = rawManifest.components[0]!;
    const source = createCapturedPackageSource(rawManifest, mutableLoaders);
    mutableLoaders[first.definitionPath] = async () => ({ default: { id: "mutated" } });

    await expect(source.load("component", first.id)).resolves.toMatchObject({ id: first.id });
  });

  it("rejects malformed generic component properties", () => {
    const definition = {
      id: "vendor:PART-1",
      pins: { "1": { name: "1", capabilities: ["passive.terminal"] } },
      ports: {},
      properties: { resistance: { unit: "ohm", value: 220 } }
    };

    expect(validateComponentDefinition(definition, definition.id).properties).toEqual({
      resistance: { unit: "ohm", value: 220 }
    });
    expect(() => validateComponentDefinition({
      ...definition,
      properties: { resistance: { unit: "ohm", value: Number.POSITIVE_INFINITY } }
    }, definition.id)).toThrow(/property resistance.value must be a finite number/);
    expect(() => validateComponentDefinition({
      ...definition,
      properties: { resistance: Number.NaN }
    }, definition.id)).toThrow(/property resistance must be a finite number/);
    expect(() => validateComponentDefinition({
      ...definition,
      properties: { resistance: { value: 220 } }
    }, definition.id)).toThrow(/property resistance.unit must be a non-empty string/);
    expect(() => validateComponentDefinition({
      ...definition,
      properties: { resistance: [] }
    }, definition.id)).toThrow(/property resistance must be an object/);
  });
});

async function loadReferencePackage(): Promise<{
  loaders: Record<string, CapturedPackageDefinitionLoader>;
  manifest: CapturedDefinitionPackageManifest;
  rawManifest: CapturedDefinitionPackageManifest;
  source: CapturedDefinitionPackageSource;
}> {
  const inputs = await readReferencePackageInputs();
  const manifest = validateCapturedDefinitionPackageManifest(inputs.rawManifest);
  return {
    ...inputs,
    manifest,
    source: createCapturedPackageSource(inputs.rawManifest, inputs.loaders)
  };
}

async function readReferencePackageInputs(): Promise<{
  loaders: Record<string, CapturedPackageDefinitionLoader>;
  rawManifest: CapturedDefinitionPackageManifest;
}> {
  const rawManifest = await readJson<CapturedDefinitionPackageManifest>(path.join(packageRoot, "manifest.json"));
  const definitionPaths = [
    ...rawManifest.components.map(({ definitionPath }) => definitionPath),
    ...(rawManifest.functions ?? []).map(({ definitionPath }) => definitionPath)
  ];
  const loaders = Object.fromEntries(
    definitionPaths.map((definitionPath) => [
      definitionPath,
      async () => ({ default: await readJson(path.join(packageRoot, definitionPath)) })
    ])
  );
  return { loaders, rawManifest };
}

async function readJson<T = unknown>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

type InventoryComponent = {
  boardFootprints: Array<{
    pins: Array<{ number: string; uuid: string }>;
    uuid: string;
  }>;
  footprintFieldAtCapture: string;
  libraryId: string;
  referenceAtCapture: string;
  schematicUuid: string;
  valueAtCapture: string;
};

type CapturedInlineRule = {
  component: string;
  dependency: string;
  enabledWhen: { field: string; values: string[] };
  id: string;
  include: string;
  pins: { connector: string; provider: string };
  signals: { group: string };
  value: { default: string; includeField: string };
};
