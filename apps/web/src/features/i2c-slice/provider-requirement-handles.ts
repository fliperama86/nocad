import { components } from "@nocad/intent-core";
import type { IntentConnectionEdge, ProjectNode, ProjectSource } from "@nocad/intent-core";

import { providerModeDefinitionForEdge } from "./provider-assignment";

const requirementHandlePrefix = "requirement:";

export type ProviderRequirementHandle = {
  acceptedContracts: string[];
  connectedEdgeId?: string;
  handleId: string;
  label: string;
  optional: boolean;
  port: string;
};

type ProviderRequirementCandidate = Omit<ProviderRequirementHandle, "handleId"> & {
  providerEdgeId: string;
};

type RequirementConnectionOption = {
  contract: string;
  to: {
    node: string;
    port: string;
  };
};

export function providerRequirementHandleId(port: string, providerEdgeId?: string) {
  const portHandle = `${requirementHandlePrefix}${encodeURIComponent(port)}`;

  return providerEdgeId ? `${portHandle}:${encodeURIComponent(providerEdgeId)}` : portHandle;
}

export function providerRequirementPortFromHandle(handleId: string | null | undefined) {
  if (!handleId?.startsWith(requirementHandlePrefix)) {
    return undefined;
  }

  const encodedPort = handleId.slice(requirementHandlePrefix.length).split(":")[0];

  try {
    return decodeURIComponent(encodedPort) || undefined;
  } catch {
    return undefined;
  }
}

export function providerRequirementHandlesForNode(
  source: ProjectSource,
  node: ProjectNode
): ProviderRequirementHandle[] {
  if (node.kind !== "component") {
    return [];
  }

  const componentDefinition = components[node.component];

  if (!componentDefinition) {
    return [];
  }

  const candidates: ProviderRequirementCandidate[] = [];

  for (const edge of source.edges) {
    if (edge.kind !== "intent.provides" || edge.from.node !== node.id) {
      continue;
    }

    const mode = edge.strategy?.providerMode ?? "auto";
    const modeDefinition = providerModeDefinitionForEdge(source, edge, mode);

    for (const [port, requirement] of Object.entries(modeDefinition?.requires?.ports ?? {})) {
      const acceptedContracts = Array.isArray(requirement.contract) ? requirement.contract : [requirement.contract];
      const connectedEdge = matchingRequirementEdge(source, node.id, port, acceptedContracts);
      const label = requirement.label ?? humanIdentifier(port);
      const optional = Boolean(requirement.optional);
      const equivalent = candidates.find(
        (existing) =>
          existing.port === port &&
          existing.label === label &&
          existing.optional === optional &&
          sameStringSet(existing.acceptedContracts, acceptedContracts)
      );

      if (equivalent) {
        equivalent.connectedEdgeId ??= connectedEdge?.id;
        continue;
      }

      candidates.push({
        acceptedContracts: uniqueStrings(acceptedContracts),
        connectedEdgeId: connectedEdge?.id,
        label,
        optional,
        port,
        providerEdgeId: edge.id
      });
    }
  }

  const countsByPort = new Map<string, number>();

  for (const candidate of candidates) {
    countsByPort.set(candidate.port, (countsByPort.get(candidate.port) ?? 0) + 1);
  }

  return candidates.map(({ providerEdgeId, ...candidate }) => ({
    ...candidate,
    handleId: providerRequirementHandleId(
      candidate.port,
      (countsByPort.get(candidate.port) ?? 0) > 1 ? providerEdgeId : undefined
    )
  }));
}

export function providerRequirementForHandle(
  source: ProjectSource,
  node: ProjectNode,
  handleId: string | null | undefined
) {
  return providerRequirementPortFromHandle(handleId)
    ? providerRequirementHandlesForNode(source, node).find((requirement) => requirement.handleId === handleId)
    : undefined;
}

export function filterConnectionOptionsForProviderRequirement<T extends RequirementConnectionOption>(
  options: T[],
  targetNodeId: string,
  requirement: ProviderRequirementHandle | undefined,
  activeRequirements: ProviderRequirementHandle[] = []
) {
  if (requirement?.connectedEdgeId) {
    return [];
  }

  if (!requirement) {
    return options.filter(
      (option) =>
        !activeRequirements.some(
          (activeRequirement) =>
            activeRequirement.connectedEdgeId &&
            option.to.node === targetNodeId &&
            option.to.port === activeRequirement.port &&
            activeRequirement.acceptedContracts.includes(option.contract)
        )
    );
  }

  return options.filter(
    (option) =>
      option.to.node === targetNodeId &&
      option.to.port === requirement.port &&
      requirement.acceptedContracts.includes(option.contract)
  );
}

export function providerRequirementTargetHandle(source: ProjectSource, edge: IntentConnectionEdge) {
  const targetNode = source.nodes.find((node) => node.id === edge.to.node);

  if (!targetNode || !edge.to.port) {
    return undefined;
  }

  return providerRequirementHandlesForNode(source, targetNode).find(
    (requirement) =>
      requirement.port === edge.to.port && requirement.acceptedContracts.includes(edge.contract)
  )?.handleId;
}

function matchingRequirementEdge(
  source: ProjectSource,
  nodeId: string,
  port: string,
  acceptedContracts: string[]
): IntentConnectionEdge | undefined {
  return source.edges.find(
    (edge): edge is IntentConnectionEdge =>
      edge.kind === "intent.connection" &&
      acceptedContracts.includes(edge.contract) &&
      ((edge.from.node === nodeId && edge.from.port === port) ||
        (edge.to.node === nodeId && edge.to.port === port))
  );
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function sameStringSet(left: string[], right: string[]) {
  const leftSet = new Set(left);

  return leftSet.size === new Set(right).size && right.every((value) => leftSet.has(value));
}

function humanIdentifier(value: string) {
  return value.replaceAll(/[_-]/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
