import type { ComponentDefinition } from "@nocad/intent-core";

type UnknownRecord = Record<string, unknown>;

export class InvalidComponentDefinitionError extends Error {
  readonly componentId: string;

  constructor(componentId: string, detail: string) {
    super(`Invalid component definition ${componentId}: ${detail}`);
    this.name = "InvalidComponentDefinitionError";
    this.componentId = componentId;
  }
}

export function validateComponentDefinition(value: unknown, expectedId: string): ComponentDefinition {
  const definition = requireRecord(value, expectedId, "definition");
  requireExactId(definition.id, expectedId);
  const pins = validatePins(definition.pins, expectedId);
  validatePorts(definition.ports, expectedId, pins);

  if (definition.board !== undefined) {
    validateBoard(definition.board, expectedId);
  }

  if (definition.preferredPinGroups !== undefined) {
    validatePreferredPinGroups(definition.preferredPinGroups, expectedId, definition);
  }

  if (definition.properties !== undefined) {
    validateProperties(definition.properties, expectedId);
  }

  return value as ComponentDefinition;
}

function validateProperties(value: unknown, id: string): void {
  const properties = requireRecord(value, id, "properties");

  for (const [propertyId, candidate] of Object.entries(properties)) {
    requireNonEmptyString(propertyId, id, "property id");
    if (
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      continue;
    }
    if (typeof candidate === "number") {
      requireFinite(candidate, id, `property ${propertyId}`);
      continue;
    }
    const quantity = requireRecord(candidate, id, `property ${propertyId}`);
    requireFinite(quantity.value, id, `property ${propertyId}.value`);
    requireNonEmptyString(quantity.unit, id, `property ${propertyId}.unit`);
  }
}

function requireExactId(value: unknown, expectedId: string): void {
  if (value !== expectedId) {
    throw invalid(expectedId, `id must exactly match ${JSON.stringify(expectedId)}`);
  }
}

function validatePins(value: unknown, id: string): UnknownRecord {
  const pins = requireRecord(value, id, "pins");

  for (const [pinId, candidate] of Object.entries(pins)) {
    requireNonEmptyString(pinId, id, "pin id");
    const pin = requireRecord(candidate, id, `pin ${pinId}`);
    requireNonEmptyString(pin.name, id, `pin ${pinId}.name`);
    requireStringArray(pin.capabilities, id, `pin ${pinId}.capabilities`);
  }

  return pins;
}

function validatePorts(value: unknown, id: string, pins: UnknownRecord): void {
  const ports = requireRecord(value, id, "ports");

  for (const [portId, candidate] of Object.entries(ports)) {
    const port = requireRecord(candidate, id, `port ${portId}`);

    if (port.kind !== "fixed_port" && port.kind !== "derived_port" && port.kind !== "pin_pool") {
      throw invalid(id, `port ${portId}.kind is unsupported`);
    }

    if (port.pinCapabilities !== undefined) {
      requireStringArray(port.pinCapabilities, id, `port ${portId}.pinCapabilities`);
    }

    if (port.contractMaps !== undefined) {
      validateContractMaps(port.contractMaps, id, portId, pins);
    }

    if (port.provides !== undefined) {
      validateProvides(port.provides, id, portId, pins);
    }
  }
}

function validateContractMaps(value: unknown, id: string, portId: string, pins: UnknownRecord): void {
  const maps = requireRecord(value, id, `port ${portId}.contractMaps`);

  for (const [contractId, candidate] of Object.entries(maps)) {
    const map = requireRecord(candidate, id, `port ${portId} contract ${contractId}`);
    if (map.role !== "from" && map.role !== "to") {
      throw invalid(id, `port ${portId} contract ${contractId}.role must be from or to`);
    }
    validateSignalMap(map.signalMap, id, `port ${portId} contract ${contractId}.signalMap`, pins);
  }
}

function validateProvides(value: unknown, id: string, portId: string, pins: UnknownRecord): void {
  const provides = requireRecord(value, id, `port ${portId}.provides`);

  for (const [contractId, candidate] of Object.entries(provides)) {
    const provided = requireRecord(candidate, id, `port ${portId} provider ${contractId}`);
    if (provided.role !== "provider") {
      throw invalid(id, `port ${portId} provider ${contractId}.role must be provider`);
    }
    const modes = requireRecord(provided.modes, id, `port ${portId} provider ${contractId}.modes`);
    for (const [modeId, modeCandidate] of Object.entries(modes)) {
      const mode = requireRecord(modeCandidate, id, `provider mode ${modeId}`);
      const signalMap = validateSignalMap(mode.signalMap, id, `provider mode ${modeId}.signalMap`, pins);
      if (mode.presets !== undefined) {
        validatePresets(mode.presets, id, modeId, pins, signalMap);
      }
      if (mode.requires !== undefined) {
        validateRequirements(mode.requires, id, modeId);
      }
    }
  }
}

function validateSignalMap(value: unknown, id: string, field: string, pins: UnknownRecord): UnknownRecord {
  const signalMap = requireRecord(value, id, field);

  for (const [signalId, candidate] of Object.entries(signalMap)) {
    const mapping = requireRecord(candidate, id, `${field}.${signalId}`);
    const hasPin = mapping.pin !== undefined;
    const hasSelector = mapping.pinSelector !== undefined;

    if (hasPin === hasSelector) {
      throw invalid(id, `${field}.${signalId} must contain exactly one of pin or pinSelector`);
    }
    if (hasPin) {
      const pin = requireNonEmptyString(mapping.pin, id, `${field}.${signalId}.pin`);
      if (pins[pin] === undefined) {
        throw invalid(id, `${field}.${signalId}.pin references missing pin ${pin}`);
      }
    } else {
      const selector = requireRecord(mapping.pinSelector, id, `${field}.${signalId}.pinSelector`);
      requireStringArray(selector.capabilities, id, `${field}.${signalId}.pinSelector.capabilities`);
    }
  }

  return signalMap;
}

function validatePresets(
  value: unknown,
  id: string,
  modeId: string,
  pins: UnknownRecord,
  signalMap: UnknownRecord
): void {
  if (!Array.isArray(value)) {
    throw invalid(id, `provider mode ${modeId}.presets must be an array`);
  }

  for (const [index, candidate] of value.entries()) {
    const preset = requireRecord(candidate, id, `provider mode ${modeId}.presets[${index}]`);
    requireNonEmptyString(preset.id, id, `provider mode ${modeId}.presets[${index}].id`);
    requireNonEmptyString(preset.label, id, `provider mode ${modeId}.presets[${index}].label`);
    const presetPins = requireRecord(preset.pins, id, `provider mode ${modeId}.presets[${index}].pins`);
    for (const [signalId, pinId] of Object.entries(presetPins)) {
      requireNonEmptyString(signalId, id, "preset signal id");
      const pin = requireNonEmptyString(pinId, id, `preset pin for ${signalId}`);
      if (pins[pin] === undefined) {
        throw invalid(id, `provider mode ${modeId} preset references missing pin ${pin}`);
      }
      validateMappedPin(signalId, pin, signalMap, pins, id, `provider mode ${modeId} preset`);
    }
  }
}

function validateRequirements(value: unknown, id: string, modeId: string): void {
  const requirements = requireRecord(value, id, `provider mode ${modeId}.requires`);
  if (requirements.ports === undefined) return;
  const ports = requireRecord(requirements.ports, id, `provider mode ${modeId}.requires.ports`);

  for (const [portId, candidate] of Object.entries(ports)) {
    const requirement = requireRecord(candidate, id, `provider mode ${modeId} requirement ${portId}`);
    if (typeof requirement.contract !== "string" && !isStringArray(requirement.contract)) {
      throw invalid(id, `provider mode ${modeId} requirement ${portId}.contract must be a string or string array`);
    }
    if (requirement.label !== undefined) {
      requireNonEmptyString(requirement.label, id, `provider mode ${modeId} requirement ${portId}.label`);
    }
    if (requirement.optional !== undefined && typeof requirement.optional !== "boolean") {
      throw invalid(id, `provider mode ${modeId} requirement ${portId}.optional must be boolean`);
    }
  }
}

function validateBoard(value: unknown, id: string): void {
  const board = requireRecord(value, id, "board");
  if (board.placementHint !== undefined) {
    throw invalid(id, "board.placementHint is not component data; placement belongs to the project layout");
  }
  const envelope = requireRecord(board.envelope, id, "board.envelope");
  if (envelope.accuracy !== "estimate" && envelope.accuracy !== "verified") {
    throw invalid(id, "board.envelope.accuracy must be estimate or verified");
  }
  requirePositiveFinite(envelope.widthMm, id, "board.envelope.widthMm");
  requirePositiveFinite(envelope.heightMm, id, "board.envelope.heightMm");
  if (envelope.source !== undefined) {
    const source = requireRecord(envelope.source, id, "board.envelope.source");
    requireNonEmptyString(source.title, id, "board.envelope.source.title");
    requireNonEmptyString(source.uri, id, "board.envelope.source.uri");
  } else if (envelope.accuracy === "verified") {
    throw invalid(id, "a verified board envelope requires source metadata");
  }
}

function validatePreferredPinGroups(value: unknown, id: string, definition: UnknownRecord): void {
  if (!Array.isArray(value)) {
    throw invalid(id, "preferredPinGroups must be an array");
  }
  const pins = requireRecord(definition.pins, id, "pins");
  const ports = requireRecord(definition.ports, id, "ports");

  for (const [index, candidate] of value.entries()) {
    const group = requireRecord(candidate, id, `preferredPinGroups[${index}]`);
    requireNonEmptyString(group.contract, id, `preferredPinGroups[${index}].contract`);
    let signalMap: UnknownRecord | undefined;
    if (group.port !== undefined) {
      const port = requireNonEmptyString(group.port, id, `preferredPinGroups[${index}].port`);
      const portCandidate = ports[port];
      if (portCandidate === undefined) {
        throw invalid(id, `preferredPinGroups[${index}].port references missing port ${port}`);
      }
      const portDefinition = requireRecord(portCandidate, id, `port ${port}`);
      const contractMaps = requireRecord(
        portDefinition.contractMaps,
        id,
        `preferredPinGroups[${index}] port ${port}.contractMaps`
      );
      const contract = requireNonEmptyString(group.contract, id, `preferredPinGroups[${index}].contract`);
      const contractMap = requireRecord(
        contractMaps[contract],
        id,
        `preferredPinGroups[${index}] port ${port} contract ${contract}`
      );
      signalMap = requireRecord(
        contractMap.signalMap,
        id,
        `preferredPinGroups[${index}] port ${port} contract ${contract}.signalMap`
      );
    }
    const assignments = requireRecord(group.pins, id, `preferredPinGroups[${index}].pins`);
    for (const [signalId, pinId] of Object.entries(assignments)) {
      requireNonEmptyString(signalId, id, "preferred pin group signal id");
      const pin = requireNonEmptyString(pinId, id, `preferred pin for ${signalId}`);
      if (pins[pin] === undefined) {
        throw invalid(id, `preferredPinGroups[${index}] references missing pin ${pin}`);
      }
      if (signalMap) {
        validateMappedPin(signalId, pin, signalMap, pins, id, `preferredPinGroups[${index}]`);
      }
    }
  }
}

function validateMappedPin(
  signalId: string,
  pinId: string,
  signalMap: UnknownRecord,
  pins: UnknownRecord,
  id: string,
  field: string
): void {
  const mappingCandidate = signalMap[signalId];
  if (mappingCandidate === undefined) {
    throw invalid(id, `${field} assigns unknown signal ${signalId}`);
  }

  const mapping = requireRecord(mappingCandidate, id, `${field} signal ${signalId}`);
  if (mapping.pin !== undefined) {
    const fixedPin = requireNonEmptyString(mapping.pin, id, `${field} signal ${signalId}.pin`);
    if (pinId !== fixedPin) {
      throw invalid(id, `${field} assigns ${signalId} to ${pinId}, but its signal map fixes it to ${fixedPin}`);
    }
    return;
  }

  const selector = requireRecord(mapping.pinSelector, id, `${field} signal ${signalId}.pinSelector`);
  const capabilities = requireStringArray(
    selector.capabilities,
    id,
    `${field} signal ${signalId}.pinSelector.capabilities`
  );
  const pin = requireRecord(pins[pinId], id, `pin ${pinId}`);
  const pinCapabilities = requireStringArray(pin.capabilities, id, `pin ${pinId}.capabilities`);
  const missingCapabilities = capabilities.filter((capability) => !pinCapabilities.includes(capability));
  if (missingCapabilities.length > 0) {
    throw invalid(
      id,
      `${field} assigns ${signalId} to ${pinId}, which lacks capabilities: ${missingCapabilities.join(", ")}`
    );
  }
}

function requireRecord(value: unknown, id: string, field: string): UnknownRecord {
  if (!isRecord(value)) {
    throw invalid(id, `${field} must be an object`);
  }
  return value;
}

function requireStringArray(value: unknown, id: string, field: string): string[] {
  if (!isStringArray(value) || value.length === 0) {
    throw invalid(id, `${field} must be an array of non-empty strings`);
  }
  if (new Set(value).size !== value.length) {
    throw invalid(id, `${field} must not contain duplicates`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, id: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invalid(id, `${field} must be a non-empty string`);
  }
  return value;
}

function requirePositiveFinite(value: unknown, id: string, field: string): number {
  if (!isFiniteNumber(value) || value <= 0) {
    throw invalid(id, `${field} must be a positive finite number`);
  }
  return value;
}

function requireFinite(value: unknown, id: string, field: string): number {
  if (!isFiniteNumber(value)) {
    throw invalid(id, `${field} must be a finite number`);
  }
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function invalid(id: string, detail: string): InvalidComponentDefinitionError {
  return new InvalidComponentDefinitionError(id, detail);
}
