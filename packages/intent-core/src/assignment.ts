import { components } from "./fixtures";
import type { IntentConnectionEdge, ProjectSource } from "./types";

export type I2cPinPairOption = {
  sda: string;
  scl: string;
};

export type ComponentPinOption = {
  capabilities: string[];
  id: string;
  name: string;
};

export function getI2cPinPairOptions(source: ProjectSource, edgeId: string): I2cPinPairOption[] {
  const edge = source.edges.find((candidate): candidate is IntentConnectionEdge => candidate.id === edgeId && candidate.kind === "intent.connection");

  if (!edge || edge.contract !== "builtin:i2c.v1") {
    return [];
  }

  const fromNode = source.nodes.find((node) => node.id === edge.from.node);

  if (!fromNode || fromNode.kind !== "component") {
    return [];
  }

  const definition = components[fromNode.component];

  return (definition?.preferredI2cPairs ?? []).filter(
    (pair) =>
      definition.pins[pair.sda]?.capabilities.includes("i2c.sda") === true &&
      definition.pins[pair.scl]?.capabilities.includes("i2c.scl") === true
  );
}

export function getComponentPinOptions(
  source: ProjectSource,
  nodeId: string,
  capability?: string
): ComponentPinOption[] {
  const node = source.nodes.find((candidate) => candidate.id === nodeId);

  if (!node || node.kind !== "component") {
    return [];
  }

  const definition = components[node.component];

  if (!definition) {
    return [];
  }

  return Object.entries(definition.pins)
    .filter(([, pin]) => !capability || pin.capabilities.includes(capability))
    .map(([id, pin]) => ({
      capabilities: pin.capabilities,
      id,
      name: pin.name
    }));
}
