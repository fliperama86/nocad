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
    componentDescriptors: readonly ComponentDescriptor[];
    contractDescriptors: readonly ContractDescriptor[];
    functionDescriptors: readonly FunctionAuthoringDescriptor[];
    packages: DefinitionPackageIndex;
  };
};
