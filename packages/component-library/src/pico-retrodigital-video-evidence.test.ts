import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  parseProjectSourceJson,
  type EndpointRef,
  type ProjectSource
} from "@nocad/intent-core";
import { describe, expect, it } from "vitest";

import { createCapturedPackageSource } from "./captured-package";
import { loadDefinitionCatalogForDependencies } from "./catalog";
import type {
  CapturedDefinitionPackageManifest,
  CapturedPackageDefinitionLoader,
  LoadedDefinitionCatalog
} from "./types";

type EvidenceRow = {
  boardFootprintUuid: string;
  boardPad1Uuid: string;
  boardPad2Uuid: string;
  connectorNet: string;
  connectorPin: string;
  gpio: number;
  j3PinUuid: string;
  reference: string;
  resistorPin1Uuid: string;
  resistorPin2Uuid: string;
  schematicUuid: string;
  signal: string;
  u3PinUuid: string;
};

type Inventory = {
  components: InventoryComponent[];
};

type InventoryComponent = {
  boardFootprints: Array<{
    libraryId: string;
    pins: Array<{
      net: string | null;
      number: string;
      uuid: string;
    }>;
    uuid: string;
  }>;
  footprintFieldAtCapture: string;
  libraryId: string;
  referenceAtCapture: string;
  schematicUuid: string;
  valueAtCapture: string;
};

type SchematicConnectivity = {
  nets: Array<{
    memberPinUuids: string[];
    name: string;
  }>;
  objects: {
    physicalComponents: Array<{
      pins: Array<{
        name: string;
        net: string | null;
        number: string;
        pinUuid: string;
      }>;
      reference: string;
      schematicUuid: string;
    }>;
  };
};

type AuthoredNet = Extract<ProjectSource["edges"][number], { kind: "net.authored" }>;
type ComponentNode = Extract<ProjectSource["nodes"][number], { kind: "component" }>;
type ProvidesEdge = Extract<ProjectSource["edges"][number], { kind: "intent.provides" }>;

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const packageManifestPath = path.join(
  repositoryRoot,
  "fixtures/definition-packages/pico-retrodigital-main/captured-instances/manifest.json"
);
const projectPath = path.join(
  repositoryRoot,
  "fixtures/semantic/pico-retrodigital-main/video-output/project.nocad.json"
);
const packageName = "reference:pico-retrodigital-main/captured-instances";
const u3Uuid = "d7a4ced3-fd77-4093-ba59-5c98b9d2e320";
const j3Uuid = "36fdde7d-0e49-40d3-aa45-e5787f57e24c";
const u3Node = `node_${u3Uuid}`;
const j3Node = `node_${j3Uuid}`;

const rows: EvidenceRow[] = [
  {
    boardFootprintUuid: "c3a9e2c9-7e43-4fd8-a624-27faf3688a33",
    boardPad1Uuid: "6470c3c9-a324-4fcc-94fb-ff2aa9e0126f",
    boardPad2Uuid: "90d86190-7f19-4ba2-aa60-e1654dceaac6",
    connectorNet: "CLK-",
    connectorPin: "7",
    gpio: 12,
    j3PinUuid: "b8167578-aa7d-4e06-bd0c-a695e1371c69",
    reference: "R4",
    resistorPin1Uuid: "811c7ca3-309f-40e6-8fd7-ed51292cc4bc",
    resistorPin2Uuid: "f36f70bd-6626-4696-bd90-afe1371e3949",
    schematicUuid: "699fdcbb-5f2e-4cf4-8507-c5f0b625ceaa",
    signal: "clock_n",
    u3PinUuid: "bfba0f1a-db82-4a41-bf0f-899c4ec48e9f"
  },
  {
    boardFootprintUuid: "917ee085-c5f1-43d8-bf04-cbce05b16ea6",
    boardPad1Uuid: "65d8d1df-5b02-457a-84f6-0b2b13a1c4d5",
    boardPad2Uuid: "47e4e8aa-5ecd-4fa1-827f-6e3739fcb382",
    connectorNet: "CLK+",
    connectorPin: "8",
    gpio: 13,
    j3PinUuid: "7fe2b36a-7553-4ba2-9708-67449dabfc09",
    reference: "R5",
    resistorPin1Uuid: "19a8997d-f587-402a-895d-0180beb6d50e",
    resistorPin2Uuid: "c885d823-a7b8-4c15-b8c9-044fa2ee47ce",
    schematicUuid: "4c986f04-6d7f-4290-9132-6391a558e27c",
    signal: "clock_p",
    u3PinUuid: "9fe94a0d-2471-46df-a5b0-b5488f0ee1b1"
  },
  {
    boardFootprintUuid: "a5fe0484-4ee8-4572-947f-12d9159f45de",
    boardPad1Uuid: "0e9ab87a-22ae-4c7a-ac39-03564ecb17c2",
    boardPad2Uuid: "8b01ec1d-e74e-4aa0-9096-dc25e1d3f804",
    connectorNet: "D0-",
    connectorPin: "9",
    gpio: 14,
    j3PinUuid: "6f58e6c8-c318-415e-9637-e40812984dab",
    reference: "R3",
    resistorPin1Uuid: "c6079020-2775-4b04-bc43-35cba078a128",
    resistorPin2Uuid: "77b83208-25ec-4452-9c39-1d39a0acb1c0",
    schematicUuid: "3f3cf7d9-1e36-4a27-b666-65449dc42c44",
    signal: "tmds0_n",
    u3PinUuid: "1e4a1cc8-dade-47b2-ac8a-802b25fbbcbb"
  },
  {
    boardFootprintUuid: "575f6c5c-8461-48a9-8183-dee5e6dae869",
    boardPad1Uuid: "27b8cffe-d0c8-402f-98cb-0dfd99c52b94",
    boardPad2Uuid: "0b786e16-f939-4740-80a9-88763536969e",
    connectorNet: "D0+",
    connectorPin: "10",
    gpio: 15,
    j3PinUuid: "867c24db-a77e-4103-9bd9-3882bb33c0a7",
    reference: "R6",
    resistorPin1Uuid: "eea3c4ef-a84e-4b85-a401-8bc042af60dd",
    resistorPin2Uuid: "c05e8867-f8fd-4d48-8159-0c04b7f27b88",
    schematicUuid: "37ef8d23-5668-433f-bef2-7a60a9657bdd",
    signal: "tmds0_p",
    u3PinUuid: "63af9d5d-fed8-4b24-a8d9-472ebca88eb7"
  },
  {
    boardFootprintUuid: "c013fd09-321a-4630-9799-8840bf8809b8",
    boardPad1Uuid: "1e5d7752-830e-4e6b-a435-89ffa537284d",
    boardPad2Uuid: "1cdd99a3-ac8a-45ed-be19-1821a2e7da46",
    connectorNet: "D1-",
    connectorPin: "11",
    gpio: 16,
    j3PinUuid: "371d9c51-40ea-4dd3-a7b4-f1e35bb68466",
    reference: "R7",
    resistorPin1Uuid: "eea3c4ef-a84e-4b85-a401-8bc042af60de",
    resistorPin2Uuid: "c05e8867-f8fd-4d48-8159-0c04b7f27b89",
    schematicUuid: "74113c65-698b-488c-aba4-4004ed3c6ebe",
    signal: "tmds1_n",
    u3PinUuid: "bfddff28-5130-4787-8cd4-e9e0dbaa0bba"
  },
  {
    boardFootprintUuid: "c423ddbd-087a-4aa9-8491-bd8958fd7bae",
    boardPad1Uuid: "f55a1dc1-d560-49c0-afad-cf600b68ae06",
    boardPad2Uuid: "2a454b7a-eab6-4787-8e5b-be1e74347607",
    connectorNet: "D1+",
    connectorPin: "12",
    gpio: 17,
    j3PinUuid: "4730db8f-5c99-459e-826f-e58594702883",
    reference: "R8",
    resistorPin1Uuid: "e7a52d68-3550-4144-b0d2-7a1f7bd093ea",
    resistorPin2Uuid: "4b664467-ed47-40c3-a895-4912157595b0",
    schematicUuid: "c488d161-5f6c-4b44-ac39-0e8f47b6486f",
    signal: "tmds1_p",
    u3PinUuid: "22f4d4c9-40ac-490c-973b-a73182fa8f70"
  },
  {
    boardFootprintUuid: "36f5d25d-02db-4e97-94a7-305282bf0145",
    boardPad1Uuid: "7ca5c68f-c782-4410-bfe8-6e99bca8f446",
    boardPad2Uuid: "cc445015-37a2-4874-856f-39955756f760",
    connectorNet: "D2-",
    connectorPin: "13",
    gpio: 18,
    j3PinUuid: "c8fb6684-2a4e-4dbd-bf8b-2c4a858b4e7e",
    reference: "R9",
    resistorPin1Uuid: "d3b4bc84-9603-49ea-a104-1609bf4087c8",
    resistorPin2Uuid: "f0a6fdc2-e9a6-45de-bb44-601037cb96e7",
    schematicUuid: "6297b249-f2ab-418b-a444-a4a6cf205c91",
    signal: "tmds2_n",
    u3PinUuid: "9a1816f8-78f0-4ceb-88df-a724c830a385"
  },
  {
    boardFootprintUuid: "9ffdf000-c14a-4062-8a57-617ba737f986",
    boardPad1Uuid: "54d72ec2-1388-4802-8f43-ff202bba042c",
    boardPad2Uuid: "19c3325c-463d-49dc-a661-417164bdd83c",
    connectorNet: "D2+",
    connectorPin: "14",
    gpio: 19,
    j3PinUuid: "fc75e58d-0d9a-44a4-99df-ba176fd71f13",
    reference: "R10",
    resistorPin1Uuid: "b390ff7f-660b-4ef8-84d8-ee42f267b294",
    resistorPin2Uuid: "15ee55b0-e01d-40ea-a804-5f0cf344673e",
    schematicUuid: "7aecee6e-638b-4fd1-ac9b-fb9df2ea1531",
    signal: "tmds2_p",
    u3PinUuid: "f14c8638-4220-40fa-94ae-e5f10f024c8f"
  }
];

describe("Pico RetroDigital video evidence acceptance", () => {
  it("joins each authored TMDS segment to exact normalized schematic, board, and captured-package evidence", async () => {
    const { manifest, catalog, project } = await loadAcceptanceInputs();
    const inventory = await readJson<Inventory>(evidencePath(manifest, "/inventory.json"));
    const connectivity = await readJson<SchematicConnectivity>(
      evidencePath(manifest, "/schematic-connectivity.json")
    );
    const provider = requiredItem(
      project.edges.filter((edge): edge is ProvidesEdge => edge.kind === "intent.provides"),
      ({ id }) => id === "video-provider",
      "video-provider edge"
    );
    const physicalU3 = physicalComponent(connectivity, "U3");
    const physicalJ3 = physicalComponent(connectivity, "J3");

    expect(componentNode(project, u3Node)).toMatchObject({
      component: "@nocad/rp2350:RP2354B",
      refdesHint: "U3"
    });
    expect(componentNode(project, j3Node)).toMatchObject({
      component: "@nocad/connectors:TE_1-1734839-4",
      refdesHint: "J3"
    });
    expect(physicalU3.schematicUuid).toBe(u3Uuid);
    expect(physicalJ3.schematicUuid).toBe(j3Uuid);
    expect(inventoryComponent(inventory, "U3").schematicUuid).toBe(u3Uuid);
    expect(inventoryComponent(inventory, "J3").schematicUuid).toBe(j3Uuid);

    for (const row of rows) {
      assertEvidenceRow({ catalog, connectivity, inventory, project, provider, row });
    }
  });
});

function assertEvidenceRow(input: {
  catalog: LoadedDefinitionCatalog;
  connectivity: SchematicConnectivity;
  inventory: Inventory;
  project: ProjectSource;
  provider: ProvidesEdge;
  row: EvidenceRow;
}) {
  const { catalog, connectivity, inventory, project, provider, row } = input;
  const resistorNode = `node_${row.schematicUuid}`;
  const componentId = `reference:pico-retrodigital-main:${row.schematicUuid}`;
  const providerNetName = `Net-(U3-GPIO${row.gpio})`;
  const feature = `seriesTermination${row.reference}`;
  const edgePrefix = `tmds-${row.signal.replaceAll("_", "-")}`;
  const providerNet = authoredNet(project, `${edgePrefix}-provider`);
  const connectorNet = authoredNet(project, `${edgePrefix}-connector`);
  const inventoryResistor = inventoryComponent(inventory, row.reference);
  const boardFootprint = requiredItem(
    inventoryResistor.boardFootprints,
    ({ uuid }) => uuid === row.boardFootprintUuid,
    `${row.reference} board footprint`
  );
  const schematicResistor = physicalComponent(connectivity, row.reference);
  const capturedDescriptor = requiredItem(
    catalog.library.capturedComponentDescriptors,
    ({ id }) => id === componentId,
    `${row.reference} captured descriptor`
  );

  expect(componentNode(project, resistorNode)).toMatchObject({
    component: componentId,
    package: "Resistor_SMD:R_0402_1005Metric",
    refdesHint: row.reference
  });
  expect(provider.bindings?.[row.signal]).toEqual({
    from: { node: u3Node, pin: `gpio${row.gpio}` }
  });
  expect(provider.generatedRealizations).toContainEqual({
    feature,
    node: resistorNode,
    signal: row.signal,
    terminals: { "1": "2", "2": "1" }
  });
  expectComparableAuthoredNet(providerNet, {
    endpoints: [
      { node: u3Node, pin: `gpio${row.gpio}` },
      { node: resistorNode, pin: "2" }
    ],
    name: providerNetName,
    realizes: {
      edge: "video-provider",
      feature,
      segment: "provider",
      signal: row.signal
    }
  });
  expectComparableAuthoredNet(connectorNet, {
    endpoints: [
      { node: resistorNode, pin: "1" },
      { node: j3Node, pin: row.signal }
    ],
    name: row.connectorNet,
    realizes: {
      edge: "video-provider",
      feature,
      segment: "connector",
      signal: row.signal
    }
  });

  expect(physicalPin(physicalComponent(connectivity, "U3"), `GPIO${row.gpio}`)).toMatchObject({
    net: providerNetName,
    pinUuid: row.u3PinUuid
  });
  expect(physicalPin(schematicResistor, "2")).toMatchObject({
    net: providerNetName,
    pinUuid: row.resistorPin2Uuid
  });
  expect(physicalPin(schematicResistor, "1")).toMatchObject({
    net: row.connectorNet,
    pinUuid: row.resistorPin1Uuid
  });
  expect(physicalPin(physicalComponent(connectivity, "J3"), row.connectorPin)).toMatchObject({
    net: row.connectorNet,
    pinUuid: row.j3PinUuid
  });
  expect(schematicNet(connectivity, providerNetName).memberPinUuids).toEqual(
    canonicalStrings([row.u3PinUuid, row.resistorPin2Uuid])
  );
  expect(schematicNet(connectivity, row.connectorNet).memberPinUuids).toEqual(
    canonicalStrings([row.resistorPin1Uuid, row.j3PinUuid])
  );

  expect(inventoryResistor).toMatchObject({
    footprintFieldAtCapture: "Resistor_SMD:R_0402_1005Metric",
    libraryId: "Device:R",
    schematicUuid: row.schematicUuid,
    valueAtCapture: "220"
  });
  expect(boardFootprint).toMatchObject({
    libraryId: "Resistor_SMD:R_0402_1005Metric",
    uuid: row.boardFootprintUuid
  });
  expect(
    boardFootprint.pins
      .map(({ net, number, uuid }) => ({ net, number, uuid }))
      .sort((left, right) => left.number.localeCompare(right.number))
  ).toEqual([
    { net: row.connectorNet, number: "1", uuid: row.boardPad1Uuid },
    { net: providerNetName, number: "2", uuid: row.boardPad2Uuid }
  ]);

  expect(capturedDescriptor).toMatchObject({
    capture: {
      boardFootprint: {
        pads: expect.arrayContaining([
          { number: "1", uuid: row.boardPad1Uuid },
          { number: "2", uuid: row.boardPad2Uuid }
        ]),
        uuid: row.boardFootprintUuid
      },
      footprintLibraryIdAtCapture: "Resistor_SMD:R_0402_1005Metric",
      referenceAtCapture: row.reference,
      symbolLibraryIdAtCapture: "Device:R",
      valueAtCapture: "220"
    },
    id: componentId,
    sourceIdentity: {
      kind: "kicad-schematic-symbol",
      referenceId: "pico-retrodigital-main",
      uuid: row.schematicUuid
    }
  });
  expect(capturedDescriptor.capture.boardFootprint.pads).toHaveLength(2);
  expect(catalog.components[componentId]?.properties).toEqual({
    resistance: { unit: "ohm", value: 220 }
  });
}

async function loadAcceptanceInputs() {
  const packageRoot = path.dirname(packageManifestPath);
  const manifest = await readJson<CapturedDefinitionPackageManifest>(packageManifestPath);
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
  const source = createCapturedPackageSource(manifest, loaders);
  const project = parseProjectSourceJson(await readFile(projectPath, "utf8"));
  const catalog = await loadDefinitionCatalogForDependencies(project.dependencies, [source]);

  expect(catalog.library.packages[packageName]).toEqual(source.package);
  return { catalog, manifest, project };
}

function authoredNet(project: ProjectSource, id: string): AuthoredNet {
  return requiredItem(
    project.edges.filter((edge): edge is AuthoredNet => edge.kind === "net.authored"),
    (edge) => edge.id === id,
    `authored net ${id}`
  );
}

function componentNode(project: ProjectSource, id: string): ComponentNode {
  return requiredItem(
    project.nodes.filter((node): node is ComponentNode => node.kind === "component"),
    (node) => node.id === id,
    `component node ${id}`
  );
}

function evidencePath(manifest: CapturedDefinitionPackageManifest, suffix: string): string {
  const evidence = requiredItem(
    manifest.evidence,
    ({ path: evidenceFile }) => evidenceFile.endsWith(suffix),
    `package evidence ${suffix}`
  );
  return path.join(repositoryRoot, evidence.path);
}

function expectComparableAuthoredNet(
  actual: AuthoredNet,
  expected: Pick<AuthoredNet, "endpoints" | "name" | "realizes">
) {
  expect({
    endpoints: canonicalEndpoints(actual.endpoints),
    name: actual.name,
    realizes: actual.realizes
  }).toEqual({
    ...expected,
    endpoints: canonicalEndpoints(expected.endpoints)
  });
}

function inventoryComponent(inventory: Inventory, reference: string): InventoryComponent {
  return requiredItem(
    inventory.components,
    ({ referenceAtCapture }) => referenceAtCapture === reference,
    `inventory component ${reference}`
  );
}

function physicalComponent(connectivity: SchematicConnectivity, reference: string) {
  return requiredItem(
    connectivity.objects.physicalComponents,
    (component) => component.reference === reference,
    `schematic component ${reference}`
  );
}

function physicalPin(component: ReturnType<typeof physicalComponent>, nameOrNumber: string) {
  return requiredItem(
    component.pins,
    (pin) => pin.name === nameOrNumber || pin.number === nameOrNumber,
    `${component.reference} pin ${nameOrNumber}`
  );
}

function schematicNet(connectivity: SchematicConnectivity, name: string) {
  const net = requiredItem(connectivity.nets, (candidate) => candidate.name === name, `schematic net ${name}`);
  return { ...net, memberPinUuids: canonicalStrings(net.memberPinUuids) };
}

function canonicalEndpoints(endpoints: EndpointRef[]): EndpointRef[] {
  return [...endpoints].sort((left, right) =>
    left.node.localeCompare(right.node) ||
    (left.pin ?? "").localeCompare(right.pin ?? "") ||
    (left.port ?? "").localeCompare(right.port ?? "")
  );
}

function canonicalStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function requiredItem<T>(items: readonly T[], predicate: (item: T) => boolean, label: string): T {
  const item = items.find(predicate);
  if (!item) throw new Error(`Missing ${label}`);
  return item;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}
