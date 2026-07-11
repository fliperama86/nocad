import { components, functions } from "@nocad/intent-core";
import type { ProjectNode } from "@nocad/intent-core";

export type FunctionComponentConnectionIntent = {
  componentPort: string;
  contract: string;
  kind: "exposes" | "provides";
  providerMode?: string;
};

export type FunctionComponentConnectionMatch =
  | {
      intent: FunctionComponentConnectionIntent;
      reason?: never;
    }
  | {
      intent?: never;
      reason: "ambiguous" | "incompatible" | "unknown-definition";
    };

export function matchFunctionComponentConnection(
  componentNode: ProjectNode,
  functionNode: ProjectNode
): FunctionComponentConnectionMatch {
  if (componentNode.kind !== "component" || functionNode.kind !== "intent.function") {
    return { reason: "incompatible" };
  }

  const componentDefinition = components[componentNode.component];
  const functionDefinition = functions[functionNode.function];

  if (!componentDefinition || !functionDefinition) {
    return { reason: "unknown-definition" };
  }

  const contract = functionDefinition.topology.contract;
  const candidates = Object.entries(componentDefinition.ports).flatMap(([componentPort, port]) => {
    const matches: FunctionComponentConnectionIntent[] = [];

    if (port.provides?.[contract]?.role === "provider") {
      const modeIds = Object.keys(port.provides[contract].modes);
      const providerMode = modeIds.includes("auto") ? "auto" : modeIds.length === 1 ? modeIds[0] : "auto";

      matches.push({ componentPort, contract, kind: "provides", providerMode });
    }

    if (port.contractMaps?.[contract]?.role === "to") {
      matches.push({ componentPort, contract, kind: "exposes" });
    }

    return matches;
  });
  const genericProvider = functionDefinition.topology.genericProvider;

  if (candidates.length === 0 && genericProvider) {
    for (const [componentPort, port] of Object.entries(componentDefinition.ports)) {
      if (
        port.kind === "pin_pool" &&
        genericProvider.pinCapabilities.every((capability) => port.pinCapabilities?.includes(capability))
      ) {
        candidates.push({
          componentPort,
          contract,
          kind: "provides",
          providerMode: genericProvider.modeId
        });
      }
    }
  }

  if (candidates.length === 1 && candidates[0]) {
    return { intent: candidates[0] };
  }

  return { reason: candidates.length > 1 ? "ambiguous" : "incompatible" };
}
