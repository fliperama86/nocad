import type {
  ComponentDescriptor,
  FunctionAuthoringDescriptor
} from "@nocad/component-library";

import type { WorkspaceNodeTemplate } from "./features/workspace/project-workspace-app";

export function componentTemplate(descriptor: ComponentDescriptor): WorkspaceNodeTemplate {
  return {
    dependency: {
      name: descriptor.package.name,
      version: descriptor.package.version
    },
    description: componentDescription(descriptor),
    id: descriptor.id,
    label: `${descriptor.manufacturer} ${descriptor.partNumber}`,
    node: {
      kind: "component",
      component: descriptor.id,
      label: descriptor.partNumber,
      ...(descriptor.devicePackage ? { package: descriptor.devicePackage } : {})
    }
  };
}

export function functionTemplate(descriptor: FunctionAuthoringDescriptor): WorkspaceNodeTemplate {
  return {
    dependency: {
      name: descriptor.package.name,
      version: descriptor.package.version
    },
    description: `Semantic function from ${descriptor.package.name}.`,
    id: `function:${descriptor.id}`,
    label: descriptor.label,
    node: {
      kind: "intent.function",
      function: descriptor.id,
      label: descriptor.label,
      ...(descriptor.defaultInclude ? { include: { ...descriptor.defaultInclude } } : {}),
      ...(descriptor.defaultRequirements ? { requirements: { ...descriptor.defaultRequirements } } : {})
    }
  };
}

function componentDescription(descriptor: ComponentDescriptor) {
  const coverage =
    descriptor.coverage === "complete"
      ? "Complete component definition."
      : "Interface definition, not package-complete.";

  return `${descriptor.description}. ${coverage}`;
}
