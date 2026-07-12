import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { builtInComponentEntries } from "./built-in-manifest";
import {
  InconsistentDefinitionPackageError,
  InvalidComponentDescriptorError
} from "./descriptor";
import { canonicalSha256, DefinitionIntegrityError } from "./integrity";
import {
  ComponentLibrary,
  createManifestSource,
  DuplicateComponentDefinitionError,
  UnknownComponentDefinitionError
} from "./library";
import { InvalidComponentDefinitionError, validateComponentDefinition } from "./validation";

describe("built-in component library", () => {
  it("contains only identified production parts", async () => {
    const library = new ComponentLibrary([createManifestSource(builtInComponentEntries)]);

    await expect(library.list()).resolves.toEqual([
      expect.objectContaining({
        coverage: "interface",
        id: "@nocad/connectors:TE_1-1734839-4",
        manufacturer: "TE Connectivity",
        package: expect.objectContaining({ name: "@nocad/connectors", version: "0.1.0" }),
        partNumber: "1-1734839-4"
      }),
      expect.objectContaining({
        coverage: "interface",
        id: "@nocad/hdmi-tx:IT66121",
        manufacturer: "ITE Tech.",
        package: expect.objectContaining({ name: "@nocad/hdmi-tx", version: "0.1.0" }),
        partNumber: "IT66121"
      }),
      expect.objectContaining({
        coverage: "interface",
        devicePackage: "QFN-60",
        id: "@nocad/rp2350:RP2350A",
        manufacturer: "Raspberry Pi",
        package: expect.objectContaining({ name: "@nocad/rp2350", version: "0.1.0" }),
        partNumber: "RP2350A"
      }),
      expect.objectContaining({
        coverage: "interface",
        devicePackage: "QFN-80",
        id: "@nocad/rp2350:RP2354B",
        manufacturer: "Raspberry Pi",
        package: expect.objectContaining({ name: "@nocad/rp2350", version: "0.1.0" }),
        partNumber: "RP2354B"
      })
    ]);
  });

  it("lists metadata without importing definition payloads", async () => {
    const entry = builtInComponentEntries.find(({ descriptor }) => descriptor.partNumber === "IT66121")!;
    const load = vi.fn(entry.load);
    const library = new ComponentLibrary([createManifestSource([{ ...entry, load }])]);

    await library.list();

    expect(load).not.toHaveBeenCalled();
  });

  it("loads, validates, freezes, and caches a definition on demand", async () => {
    const entry = builtInComponentEntries.find(({ descriptor }) => descriptor.partNumber === "IT66121");
    expect(entry).toBeDefined();
    const load = vi.fn(entry!.load);
    const library = new ComponentLibrary([createManifestSource([{ ...entry!, load }])]);

    const first = await library.load(entry!.descriptor.id);
    const second = await library.load(entry!.descriptor.id);

    expect(first).toBe(second);
    expect(load).toHaveBeenCalledTimes(1);
    expect(first?.definition.id).toBe("@nocad/hdmi-tx:IT66121");
    expect(first?.definition.ports.video_in).toBeDefined();
    expect(Object.isFrozen(first?.definition)).toBe(true);
    expect(Object.isFrozen(first?.definition.pins)).toBe(true);
  });

  it("marks current physical package envelopes as estimates without project placement data", async () => {
    const library = new ComponentLibrary([createManifestSource(builtInComponentEntries)]);
    const rp2350a = await library.load("@nocad/rp2350:RP2350A");
    const rp2354b = await library.load("@nocad/rp2350:RP2354B");

    expect(rp2350a?.descriptor.devicePackage).toBe("QFN-60");
    expect(rp2350a?.definition.board).toEqual({
      envelope: { accuracy: "estimate", widthMm: 7, heightMm: 7 }
    });
    expect(rp2354b?.descriptor.devicePackage).toBe("QFN-80");
    expect(rp2354b?.definition.board).toEqual({
      envelope: { accuracy: "estimate", widthMm: 10, heightMm: 10 }
    });
  });

  it("loads a selected definition catalog asynchronously", async () => {
    const library = new ComponentLibrary([createManifestSource(builtInComponentEntries)]);

    const definitions = await library.loadDefinitions([
      "@nocad/rp2350:RP2350A",
      "@nocad/connectors:TE_1-1734839-4"
    ]);

    expect(Object.keys(definitions)).toEqual([
      "@nocad/rp2350:RP2350A",
      "@nocad/connectors:TE_1-1734839-4"
    ]);
    expect(Object.isFrozen(definitions)).toBe(true);
  });

  it("loads and validates every built-in definition", async () => {
    const library = new ComponentLibrary([createManifestSource(builtInComponentEntries)]);

    await expect(library.loadDefinitions()).resolves.toEqual(
      expect.objectContaining({
        "@nocad/connectors:TE_1-1734839-4": expect.any(Object),
        "@nocad/hdmi-tx:IT66121": expect.any(Object),
        "@nocad/rp2350:RP2350A": expect.any(Object),
        "@nocad/rp2350:RP2354B": expect.any(Object)
      })
    );
  });

  it("pins each package descriptor to its definition content", async () => {
    const definitionPaths: Record<string, string> = {
      "@nocad/connectors:TE_1-1734839-4": "definitions/te-connectivity/1-1734839-4.json",
      "@nocad/hdmi-tx:IT66121": "definitions/ite/it66121.json",
      "@nocad/rp2350:RP2350A": "definitions/raspberry-pi/rp2350a.json",
      "@nocad/rp2350:RP2354B": "definitions/raspberry-pi/rp2354b.json"
    };

    for (const entry of builtInComponentEntries) {
      const content = JSON.parse(
        await readFile(new URL(definitionPaths[entry.descriptor.id], import.meta.url), "utf8")
      );
      expect(entry.descriptor.definitionHash).toBe(canonicalSha256(content));
    }
  });

  it("uses one dependency identity for every definition in the same package", () => {
    const packages = new Map<string, { contentHash: string; version: string }>();

    for (const { descriptor } of builtInComponentEntries) {
      const current = packages.get(descriptor.package.name);
      if (current) {
        expect(descriptor.package).toEqual(expect.objectContaining(current));
      } else {
        packages.set(descriptor.package.name, {
          contentHash: descriptor.package.contentHash,
          version: descriptor.package.version
        });
      }
    }
  });

  it("pins package identities to their ordered descriptor closure", () => {
    for (const packageName of new Set(builtInComponentEntries.map(({ descriptor }) => descriptor.package.name))) {
      const descriptors = builtInComponentEntries
        .map(({ descriptor }) => descriptor)
        .filter((descriptor) => descriptor.package.name === packageName);
      const contentHash = canonicalSha256(
        descriptors
          .map(({ definitionHash, id }) => ({ definitionHash, id, kind: "component" }))
          .sort((left, right) => left.id.localeCompare(right.id))
      );
      expect(descriptors.length).toBeGreaterThan(0);
      for (const descriptor of descriptors) {
        expect(descriptor.package.contentHash).toBe(contentHash);
      }
    }
  });

  it("returns undefined for an unknown single lookup and rejects it in a requested catalog", async () => {
    const library = new ComponentLibrary([createManifestSource(builtInComponentEntries)]);

    await expect(library.load("vendor:missing")).resolves.toBeUndefined();
    await expect(library.loadDefinitions(["vendor:missing"])).rejects.toBeInstanceOf(
      UnknownComponentDefinitionError
    );
  });
});

describe("component source composition", () => {
  it("rejects duplicate manifest ids before loading", () => {
    const [entry] = builtInComponentEntries;

    expect(() => createManifestSource([entry, entry])).toThrow(DuplicateComponentDefinitionError);
  });

  it("rejects an id provided by multiple sources", async () => {
    const [entry] = builtInComponentEntries;
    const library = new ComponentLibrary([createManifestSource([entry]), createManifestSource([entry])]);

    await expect(library.list()).rejects.toBeInstanceOf(DuplicateComponentDefinitionError);
    await expect(library.load(entry.descriptor.id)).rejects.toBeInstanceOf(DuplicateComponentDefinitionError);
  });

  it("validates external source data with the same generic boundary", async () => {
    const id = "vendor:PART-1";
    const definitionHash = `sha256:${"0".repeat(64)}`;
    const packageHash = canonicalSha256([{ definitionHash, id, kind: "component" }]);
    const source = createManifestSource([
      {
        descriptor: {
          coverage: "interface",
          definitionHash,
          description: "Test part",
          id,
          manufacturer: "Vendor",
          package: { contentHash: packageHash, name: "vendor", version: "1.0.0" },
          partNumber: "PART-1"
        },
        load: async () => ({
          default: {
            id,
            pins: { input: { name: "Input", capabilities: ["digital.input"] } },
            ports: {
              input: {
                kind: "fixed_port",
                contractMaps: {
                  "vendor:contract.v1": {
                    role: "to",
                    signalMap: { signal: { pin: "missing" } }
                  }
                }
              }
            }
          }
        })
      }
    ]);

    await expect(new ComponentLibrary([source]).load(id)).rejects.toEqual(
      expect.objectContaining<Partial<InvalidComponentDefinitionError>>({
        componentId: id,
        name: "InvalidComponentDefinitionError"
      })
    );
  });

  it("verifies loaded definitions against their canonical runtime hash", async () => {
    const id = "vendor:PART-1";
    const expected = simpleDefinition(id, "Expected");
    const definitionHash = canonicalSha256(expected);
    const descriptor = validDescriptor(id, definitionHash);
    const source = createManifestSource([
      {
        descriptor,
        load: async () => ({ default: simpleDefinition(id, "Tampered") })
      }
    ]);

    await expect(new ComponentLibrary([source]).load(id)).rejects.toBeInstanceOf(
      DefinitionIntegrityError
    );
  });

  it("deep-clones and freezes descriptor data at source ingress", async () => {
    const id = "vendor:PART-1";
    const definitionHash = canonicalSha256(simpleDefinition(id, "Pin"));
    const descriptor = validDescriptor(id, definitionHash);
    const source = createManifestSource([
      { descriptor, load: async () => ({ default: simpleDefinition(id, "Pin") }) }
    ]);
    descriptor.manufacturer = "Mutated";
    descriptor.package.version = "9.9.9";

    const [loaded] = await new ComponentLibrary([source]).list();

    expect(loaded.manufacturer).toBe("Vendor");
    expect(loaded.package.version).toBe("1.0.0");
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.package)).toBe(true);
  });

  it("rejects generic identities and invalid package closure hashes", async () => {
    const id = "vendor:PART-1";
    const definitionHash = canonicalSha256(simpleDefinition(id, "Pin"));
    const generic = validDescriptor(id, definitionHash);
    generic.partNumber = "GENERIC_FPGA";

    expect(() =>
      createManifestSource([{ descriptor: generic, load: async () => ({ default: simpleDefinition(id, "Pin") }) }])
    ).toThrow(InvalidComponentDescriptorError);

    const invalidClosure = validDescriptor(id, definitionHash);
    invalidClosure.package.contentHash = `sha256:${"f".repeat(64)}`;
    const library = new ComponentLibrary([
      createManifestSource([
        { descriptor: invalidClosure, load: async () => ({ default: simpleDefinition(id, "Pin") }) }
      ])
    ]);
    await expect(library.list()).rejects.toBeInstanceOf(InconsistentDefinitionPackageError);
  });
});

describe("component definition relationship validation", () => {
  it("requires source metadata for verified board envelopes", () => {
    const definition = simpleDefinition("vendor:PART-1", "Pin") as ReturnType<typeof simpleDefinition> & {
      board?: unknown;
    };
    definition.board = {
      envelope: { accuracy: "verified", heightMm: 2, widthMm: 3 }
    };

    expect(() => validateComponentDefinition(definition, definition.id)).toThrow(
      /verified board envelope requires source metadata/
    );

    definition.board = {
      envelope: {
        accuracy: "verified",
        heightMm: 2,
        widthMm: 3,
        source: { title: "Manufacturer drawing", uri: "https://example.test/drawing" }
      }
    };
    expect(validateComponentDefinition(definition, definition.id).board?.envelope.accuracy).toBe("verified");
  });
  it("rejects provider preset signals outside the selected mode", () => {
    const definition = providerDefinition({ signal: selector("digital") }, { unknown: "pin_a" });

    expect(() => validateComponentDefinition(definition, definition.id)).toThrow(/assigns unknown signal unknown/);
  });

  it("rejects provider presets that override a fixed signal pin", () => {
    const definition = providerDefinition({ signal: { pin: "pin_a" } }, { signal: "pin_b" });

    expect(() => validateComponentDefinition(definition, definition.id)).toThrow(
      /assigns signal to pin_b, but its signal map fixes it to pin_a/
    );
  });

  it("rejects provider preset pins that do not satisfy selector capabilities", () => {
    const definition = providerDefinition({ signal: selector("high_speed") }, { signal: "pin_a" });

    expect(() => validateComponentDefinition(definition, definition.id)).toThrow(
      /pin_a, which lacks capabilities: high_speed/
    );
  });

  it("rejects a preferred group whose declared port does not map its contract", () => {
    const definition = preferredGroupDefinition({
      contractMaps: {
        "vendor:other.v1": { role: "from", signalMap: { signal: selector("digital") } }
      },
      groupContract: "vendor:expected.v1",
      groupPins: { signal: "pin_a" }
    });

    expect(() => validateComponentDefinition(definition, definition.id)).toThrow(
      /port output contract vendor:expected.v1 must be an object/
    );
  });

  it("rejects preferred group signals outside the port contract map", () => {
    const definition = preferredGroupDefinition({
      contractMaps: {
        "vendor:contract.v1": { role: "from", signalMap: { signal: selector("digital") } }
      },
      groupContract: "vendor:contract.v1",
      groupPins: { unknown: "pin_a" }
    });

    expect(() => validateComponentDefinition(definition, definition.id)).toThrow(/assigns unknown signal unknown/);
  });

  it("rejects preferred group pins that conflict with fixed maps or selector capabilities", () => {
    const fixed = preferredGroupDefinition({
      contractMaps: {
        "vendor:contract.v1": { role: "from", signalMap: { signal: { pin: "pin_a" } } }
      },
      groupContract: "vendor:contract.v1",
      groupPins: { signal: "pin_b" }
    });
    const selected = preferredGroupDefinition({
      contractMaps: {
        "vendor:contract.v1": { role: "from", signalMap: { signal: selector("high_speed") } }
      },
      groupContract: "vendor:contract.v1",
      groupPins: { signal: "pin_a" }
    });

    expect(() => validateComponentDefinition(fixed, fixed.id)).toThrow(/fixes it to pin_a/);
    expect(() => validateComponentDefinition(selected, selected.id)).toThrow(/lacks capabilities: high_speed/);
  });
});

function selector(...capabilities: string[]) {
  return { pinSelector: { capabilities } };
}

function providerDefinition(signalMap: Record<string, unknown>, presetPins: Record<string, string>) {
  return {
    id: "vendor:PROVIDER",
    pins: {
      pin_a: { name: "A", capabilities: ["digital"] },
      pin_b: { name: "B", capabilities: ["digital", "high_speed"] }
    },
    ports: {
      output: {
        kind: "derived_port",
        provides: {
          "vendor:contract.v1": {
            role: "provider",
            modes: {
              mode: {
                presets: [{ id: "preset", label: "Preset", pins: presetPins }],
                signalMap
              }
            }
          }
        }
      }
    }
  };
}

function preferredGroupDefinition(options: {
  contractMaps: Record<string, unknown>;
  groupContract: string;
  groupPins: Record<string, string>;
}) {
  return {
    id: "vendor:PREFERRED",
    pins: {
      pin_a: { name: "A", capabilities: ["digital"] },
      pin_b: { name: "B", capabilities: ["digital", "high_speed"] }
    },
    ports: {
      output: {
        kind: "derived_port",
        contractMaps: options.contractMaps
      }
    },
    preferredPinGroups: [
      {
        contract: options.groupContract,
        pins: options.groupPins,
        port: "output"
      }
    ]
  };
}

function simpleDefinition(id: string, pinName: string) {
  return {
    id,
    pins: { pin: { name: pinName, capabilities: ["digital"] } },
    ports: {}
  };
}

function validDescriptor(id: string, definitionHash: string) {
  return {
    coverage: "interface" as const,
    definitionHash,
    description: "Production part",
    id,
    manufacturer: "Vendor",
    package: {
      contentHash: canonicalSha256([{ definitionHash, id, kind: "component" }]),
      name: "vendor",
      version: "1.0.0"
    },
    partNumber: "PART-1"
  };
}
