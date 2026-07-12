import type {
  ComponentDefinition,
  ConnectionContract,
  DefinitionCatalog,
  FunctionDefinition,
  SignalPinMap
} from "@nocad/intent-core";

import { cloneJsonValue, deepFreeze } from "./integrity";

type UnknownRecord = Record<string, unknown>;

export class InvalidCatalogDefinitionError extends Error {
  readonly definitionId: string;

  constructor(definitionId: string, detail: string) {
    super(`Invalid catalog definition ${definitionId}: ${detail}`);
    this.name = "InvalidCatalogDefinitionError";
    this.definitionId = definitionId;
  }
}

export class DefinitionCatalogClosureError extends Error {
  constructor(detail: string) {
    super(`Definition catalog is not closed: ${detail}`);
    this.name = "DefinitionCatalogClosureError";
  }
}

export function validateConnectionContract(value: unknown, expectedId: string): ConnectionContract {
  const cloned = cloneJsonValue(value);
  const contract = record(cloned, expectedId, "definition");
  exactId(contract.id, expectedId);
  const signals = record(contract.signals, expectedId, "signals");
  if (Object.keys(signals).length === 0) invalid(expectedId, "signals must not be empty");
  for (const [signalId, candidate] of Object.entries(signals)) {
    const signal = record(candidate, expectedId, `signal ${signalId}`);
    if (
      signal.direction !== "bidirectional" &&
      signal.direction !== "from_to_to" &&
      signal.direction !== "to_to_from"
    ) {
      invalid(expectedId, `signal ${signalId}.direction is unsupported`);
    }
    if (
      signal.boardKind !== undefined &&
      signal.boardKind !== "highSpeed" &&
      signal.boardKind !== "power" &&
      signal.boardKind !== "signal"
    ) {
      invalid(expectedId, `signal ${signalId}.boardKind is unsupported`);
    }
  }
  if (contract.params !== undefined) record(contract.params, expectedId, "params");
  if (contract.presets !== undefined && !Array.isArray(contract.presets)) {
    invalid(expectedId, "presets must be an array");
  }
  if (contract.signalPlan !== undefined && !Array.isArray(contract.signalPlan)) {
    invalid(expectedId, "signalPlan must be an array");
  }
  if (contract.topologyRules !== undefined && !Array.isArray(contract.topologyRules)) {
    invalid(expectedId, "topologyRules must be an array");
  }
  return deepFreeze(cloned as ConnectionContract);
}

export function validateFunctionDefinition(value: unknown, expectedId: string): FunctionDefinition {
  const cloned = cloneJsonValue(value);
  const definition = record(cloned, expectedId, "definition");
  exactId(definition.id, expectedId);
  record(definition.include, expectedId, "include");
  if (!Array.isArray(definition.signalGroups)) invalid(expectedId, "signalGroups must be an array");
  for (const [groupIndex, candidate] of definition.signalGroups.entries()) {
    const group = record(candidate, expectedId, `signalGroups[${groupIndex}]`);
    text(group.id, expectedId, `signalGroups[${groupIndex}].id`);
    if (!Array.isArray(group.signals)) invalid(expectedId, `signalGroups[${groupIndex}].signals must be an array`);
    for (const [signalIndex, signalCandidate] of group.signals.entries()) {
      const signal = record(signalCandidate, expectedId, `signalGroups[${groupIndex}].signals[${signalIndex}]`);
      text(signal.id, expectedId, `signalGroups[${groupIndex}].signals[${signalIndex}].id`);
      if (signal.pinControl !== "always" && signal.pinControl !== "custom_only") {
        invalid(expectedId, `signalGroups[${groupIndex}].signals[${signalIndex}].pinControl is unsupported`);
      }
    }
  }
  const topology = record(definition.topology, expectedId, "topology");
  text(topology.contract, expectedId, "topology.contract");
  if (topology.inlineRules !== undefined && !Array.isArray(topology.inlineRules)) {
    invalid(expectedId, "topology.inlineRules must be an array");
  }
  if (topology.generatedNets !== undefined && !Array.isArray(topology.generatedNets)) {
    invalid(expectedId, "topology.generatedNets must be an array");
  }
  return deepFreeze(cloned as FunctionDefinition);
}

export function validateDefinitionCatalogClosure(catalog: DefinitionCatalog): void {
  for (const component of Object.values(catalog.components)) validateComponentClosure(component, catalog);
  for (const contract of Object.values(catalog.contracts)) validateContractClosure(contract, catalog);
  for (const definition of Object.values(catalog.functions)) validateFunctionClosure(definition, catalog);
}

function validateComponentClosure(component: ComponentDefinition, catalog: DefinitionCatalog): void {
  for (const group of component.preferredPinGroups ?? []) {
    requireContract(catalog, group.contract, `${component.id} preferred pin group`);
  }
  for (const [portId, port] of Object.entries(component.ports)) {
    for (const [contractId, map] of Object.entries(port.contractMaps ?? {})) {
      const contract = requireContract(catalog, contractId, `${component.id}.${portId}`);
      validateSignalMapClosure(map.signalMap, contract, `${component.id}.${portId}`);
    }
    for (const [contractId, provider] of Object.entries(port.provides ?? {})) {
      const contract = requireContract(catalog, contractId, `${component.id}.${portId}`);
      for (const [modeId, mode] of Object.entries(provider.modes)) {
        validateSignalMapClosure(mode.signalMap, contract, `${component.id}.${portId}.${modeId}`);
        for (const [requiredPort, requirement] of Object.entries(mode.requires?.ports ?? {})) {
          const contractIds = Array.isArray(requirement.contract) ? requirement.contract : [requirement.contract];
          for (const requiredContract of contractIds) {
            requireContract(catalog, requiredContract, `${component.id}.${portId}.${modeId}.${requiredPort}`);
          }
        }
      }
    }
  }
}

function validateContractClosure(contract: ConnectionContract, catalog: DefinitionCatalog): void {
  for (const rule of contract.topologyRules ?? []) {
    if (!catalog.components[rule.component]) {
      throw new DefinitionCatalogClosureError(`${contract.id} references missing component ${rule.component}`);
    }
  }
}

function validateFunctionClosure(definition: FunctionDefinition, catalog: DefinitionCatalog): void {
  const contract = requireContract(catalog, definition.topology.contract, definition.id);
  for (const group of definition.signalGroups) {
    for (const signal of group.signals) {
      if (!contract.signals[signal.id]) {
        throw new DefinitionCatalogClosureError(
          `${definition.id} signal ${signal.id} is absent from ${contract.id}`
        );
      }
    }
  }
  for (const rule of definition.topology.inlineRules ?? []) {
    if (!catalog.components[rule.component]) {
      throw new DefinitionCatalogClosureError(`${definition.id} references missing component ${rule.component}`);
    }
  }
}

function validateSignalMapClosure(
  signalMap: Record<string, SignalPinMap>,
  contract: ConnectionContract,
  owner: string
): void {
  for (const signalId of Object.keys(signalMap)) {
    if (!contract.signals[signalId]) {
      throw new DefinitionCatalogClosureError(`${owner} maps unknown ${contract.id} signal ${signalId}`);
    }
  }
}

function requireContract(catalog: DefinitionCatalog, contractId: string, owner: string): ConnectionContract {
  const contract = catalog.contracts[contractId];
  if (!contract) throw new DefinitionCatalogClosureError(`${owner} references missing contract ${contractId}`);
  return contract;
}

function exactId(value: unknown, expectedId: string): void {
  if (value !== expectedId) invalid(expectedId, `id must exactly match ${expectedId}`);
}

function record(value: unknown, id: string, field: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(id, `${field} must be an object`);
  return value as UnknownRecord;
}

function text(value: unknown, id: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(id, `${field} must be a non-empty string`);
  return value;
}

function invalid(id: string, detail: string): never {
  throw new InvalidCatalogDefinitionError(id, detail);
}
