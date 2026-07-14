import type {
  ComponentDefinition,
  DefinitionCatalog
} from "@nocad/intent-core";

export type ComponentDescriptor = {
  coverage: "interface" | "complete";
  definitionHash: string;
  description: string;
  devicePackage?: string;
  id: string;
  manufacturer: string;
  package: ComponentPackageDescriptor;
  partNumber: string;
  provenance?: readonly ComponentProvenance[];
};

export type CapturedComponentDescriptor = {
  capture: CapturedComponentFacts;
  coverage: "interface";
  definitionHash: string;
  description: string;
  id: string;
  origin: "captured-instance";
  package: ComponentPackageDescriptor;
  provenance: readonly ComponentProvenance[];
  sourceIdentity: CapturedComponentSourceIdentity;
  visibility: "dependency-only";
};

export type CapturedComponentFacts = {
  boardFootprint: {
    pads: readonly {
      number: string;
      uuid: string;
    }[];
    uuid: string;
  };
  footprintLibraryIdAtCapture: string;
  referenceAtCapture: string;
  symbolLibraryIdAtCapture: string;
  valueAtCapture: string;
};

export type CapturedComponentSourceIdentity = {
  kind: "kicad-schematic-symbol";
  referenceId: string;
  uuid: string;
};

export type ComponentPackageDescriptor = {
  contentHash: string;
  name: string;
  version: string;
};

export type ComponentProvenance = {
  title: string;
  uri: string;
};

export type ComponentDefinitionModule = {
  default: unknown;
};

export type CapturedPackageDefinitionLoader = () => Promise<ComponentDefinitionModule>;

export type CapturedDefinitionPackageManifest = {
  components: readonly CapturedPackageComponentEntry[];
  evidence: readonly CapturedPackageEvidence[];
  functions?: readonly CapturedPackageFunctionEntry[];
  package: ComponentPackageDescriptor;
  schema: "nocad.captured-definition-package.v1";
};

export type CapturedPackageComponentEntry = Omit<CapturedComponentDescriptor, "package"> & {
  definitionPath: string;
};

export type CapturedPackageFunctionEntry = Omit<CapturedFunctionDescriptor, "package"> & {
  definitionPath: string;
};

export type CapturedDefinitionPackageSource = {
  componentDescriptors: readonly CapturedComponentDescriptor[];
  functionDescriptors: readonly CapturedFunctionDescriptor[];
  load: (
    kind: "component" | "function",
    id: string
  ) => Promise<unknown | undefined>;
  package: ComponentPackageDescriptor;
};

export type CapturedFunctionDescriptor = FunctionAuthoringDescriptor & {
  origin: "reference";
  provenance: readonly ComponentProvenance[];
  sourceIdentity: {
    kind: "reference-design";
    referenceId: string;
  };
  visibility: "dependency-only";
};

export type CapturedPackageEvidence = {
  path: string;
  sha256: string;
};

export type ComponentLibraryEntry = {
  descriptor: ComponentDescriptor;
  load: () => Promise<ComponentDefinitionModule>;
};

export type ComponentDefinitionSource = {
  list: () => Promise<readonly ComponentDescriptor[]>;
  load: (id: string) => Promise<unknown | undefined>;
};

export type LoadedComponent = {
  definition: ComponentDefinition;
  descriptor: ComponentDescriptor;
};

export type DefinitionKind = "component" | "contract" | "function";

export type LibraryDefinitionDescriptor = {
  definitionHash: string;
  id: string;
  kind: DefinitionKind;
  package: ComponentPackageDescriptor;
};

export type ContractDescriptor = LibraryDefinitionDescriptor & {
  kind: "contract";
  label: string;
};

export type FunctionAuthoringDescriptor = LibraryDefinitionDescriptor & {
  defaultInclude?: Readonly<Record<string, unknown>>;
  defaultRequirements?: Readonly<Record<string, unknown>>;
  kind: "function";
  label: string;
};

export type LibraryDefinitionEntry<TDescriptor extends LibraryDefinitionDescriptor> = {
  descriptor: TDescriptor;
  load: () => Promise<ComponentDefinitionModule>;
};

export type DefinitionPackageIndex = Readonly<Record<string, ComponentPackageDescriptor>>;

export type LoadedDefinitionCatalog = DefinitionCatalog & {
  library: {
    capturedComponentDescriptors: readonly CapturedComponentDescriptor[];
    capturedFunctionDescriptors: readonly CapturedFunctionDescriptor[];
    componentDescriptors: readonly ComponentDescriptor[];
    contractDescriptors: readonly ContractDescriptor[];
    functionDescriptors: readonly FunctionAuthoringDescriptor[];
    packages: DefinitionPackageIndex;
  };
};
