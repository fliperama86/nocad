export type EndpointRole = "from" | "to";

export type EndpointRef = {
  node: string;
  pin?: string;
  port?: string;
};

export type SignalBindings = Record<string, Partial<Record<EndpointRole, EndpointRef>>>;
export type ContractParamValue = string | number | boolean;
export type ContractParams = Record<string, ContractParamValue>;

export type ProjectSource = {
  schema: "nocad.project.v0";
  id: string;
  name: string;
  dependencies: Record<string, string>;
  board?: {
    id: string;
    layers: number;
    size: {
      width: string;
      height: string;
    };
  };
  layout?: {
    board: string;
    placements: Record<string, unknown>;
    routingIntent: unknown[];
  };
  nodes: ProjectNode[];
  edges: ProjectEdge[];
};

export type ProjectNode = ComponentNode | FunctionNode | PowerDomainNode;

export type GraphObjectMetadata = {
  label?: string;
  role?: string;
  refdesHint?: string;
};

export type ComponentNode = GraphObjectMetadata & {
  id: string;
  kind: "component";
  component: string;
  package?: string;
};

export type FunctionNode = GraphObjectMetadata & {
  id: string;
  kind: "intent.function";
  function: string;
  requirements?: Record<string, unknown>;
  include?: Record<string, unknown>;
};

export type PowerDomainNode = GraphObjectMetadata & {
  id: string;
  kind: "powerDomain";
  voltage: string;
};

export type ProjectEdge = IntentConnectionEdge | IntentProvidesEdge | IntentExposesEdge | NetBindingEdge;

export type IntentStrategy = {
  pinAssignment?: "auto" | "manual";
  providerMode?: string;
};

export type IntentConnectionEdge = GraphObjectMetadata & {
  id: string;
  kind: "intent.connection";
  from: EndpointRef;
  to: EndpointRef;
  contract: string;
  params?: ContractParams;
  strategy?: IntentStrategy;
  include?: Record<string, boolean>;
  bindings?: SignalBindings;
};

export type IntentProvidesEdge = GraphObjectMetadata & {
  id: string;
  kind: "intent.provides";
  from: EndpointRef;
  to: EndpointRef;
  contract: string;
  strategy?: IntentStrategy;
  bindings?: SignalBindings;
};

export type IntentExposesEdge = GraphObjectMetadata & {
  id: string;
  kind: "intent.exposes";
  from: EndpointRef;
  to: EndpointRef;
  contract: string;
};

export type NetBindingEdge = GraphObjectMetadata & {
  id: string;
  kind: "net.binding";
  bindings: SignalBindings;
};

export type ComponentDefinition = {
  id: string;
  pins: Record<string, PinDefinition>;
  ports: Record<string, PortDefinition>;
  preferredPinGroups?: PreferredPinGroupDefinition[];
};

export type PreferredPinGroupDefinition = {
  contract: string;
  pins: Record<string, string>;
  port?: string;
  suggestion?: {
    title: string;
  };
};

export type FunctionDefinition = {
  id: string;
  include: Record<string, FunctionIncludeDefinition>;
  signalGroups: FunctionSignalGroup[];
  topology: FunctionTopologyDefinition;
};

export type FunctionTopologyDefinition = {
  contract: string;
  generatedNets?: FunctionGeneratedNetDefinition[];
  genericProvider?: GenericFunctionProviderDefinition;
  inlineRules?: FunctionInlineRuleDefinition[];
};

export type FunctionInlineRuleDefinition = {
  component: string;
  dependency: string;
  enabledWhen: {
    field: string;
    values: Array<string | number | boolean>;
  };
  generatedIdPrefix: string;
  id: string;
  include: string;
  kind: "seriesInterposer";
  pins: {
    connector: string;
    provider: string;
  };
  placement?: {
    near: "connector" | "provider";
  };
  signals: {
    group: string;
  };
  value: {
    default: string;
    includeField?: string;
  };
};

export type GenericFunctionProviderDefinition = {
  label?: string;
  modeId: string;
  pinCapabilities: string[];
};

export type FunctionGeneratedNetDefinition = {
  diagnostics: {
    missingFrom: { code: string; message: string };
    missingTo: { code: string; message: string };
  };
  direction: ContractSignal["direction"];
  from: {
    kind: "powerDomain";
    role?: string;
    voltage?: string;
  };
  id: string;
  include?: string;
  name: string;
  to: {
    kind: "exposedPin";
    pin: string;
  };
};

export type FunctionIncludeDefinition =
  | {
      kind: "boolean";
      label: string;
      default?: boolean;
      readonly?: boolean;
    }
  | {
      kind: "enum";
      label: string;
      default?: string;
      options: FunctionEnumOption[];
    }
  | {
      kind: "object";
      label: string;
      fields: Record<string, FunctionIncludeFieldDefinition>;
    };

export type FunctionIncludeFieldDefinition =
  | {
      kind: "enum";
      label: string;
      default?: string;
      options: FunctionEnumOption[];
    }
  | {
      kind: "resistance" | "string";
      label: string;
      default?: string;
    };

export type FunctionEnumOption = {
  label: string;
  value: string;
};

export type FunctionSignalGroup = {
  id: string;
  include?: string;
  label: string;
  signals: FunctionSignalDefinition[];
};

export type FunctionSignalDefinition = {
  id: string;
  label: string;
  pinControl: "always" | "custom_only";
};

export type PinDefinition = {
  name: string;
  capabilities: string[];
};

export type PortDefinition = {
  kind: "fixed_port" | "derived_port" | "pin_pool";
  contractMaps?: Record<string, PortContractMap>;
  pinCapabilities?: string[];
  provides?: Record<string, PortProvidesDefinition>;
};

export type PortContractMap = {
  role: EndpointRole;
  signalMap: Record<string, SignalPinMap>;
};

export type PortProvidesDefinition = {
  role: "provider";
  modes: Record<string, ProviderModeDefinition>;
};

export type ProviderModeDefinition = {
  label?: string;
  requires?: ProviderModeRequirements;
  signalMap: Record<string, SignalPinMap>;
};

export type ProviderModeRequirements = {
  ports?: Record<string, ProviderPortRequirement>;
};

export type ProviderPortRequirement = {
  contract: string | string[];
  label?: string;
  optional?: boolean;
};

export type SignalPinMap =
  | {
      pin: string;
    }
  | {
      pinSelector: {
        capabilities: string[];
      };
    };

export type ConnectionContract = {
  id: string;
  label?: string;
  netNamePrefix?: string;
  params?: Record<string, ContractParamDefinition>;
  presets?: ContractParamPreset[];
  signalPlan?: ContractSignalPlanItem[];
  signals: Record<string, ContractSignal>;
  topologyRules?: ConnectionTopologyRuleDefinition[];
};

export type ConnectionTopologyRuleDefinition = {
  component: string;
  dependency: string;
  diagnostics: {
    missingRail: { code: string; message: string };
  };
  generatedIdPrefix: string;
  id: string;
  include: string;
  kind: "shuntToPower";
  rail: {
    role?: string;
    voltage?: string;
  };
  signals: string[];
  value: string;
};

export type ContractParamDefinition =
  | {
      kind: "boolean";
      label: string;
      default?: boolean;
    }
  | {
      kind: "enum";
      label: string;
      default?: string;
      options: ContractParamOption<string>[];
    }
  | {
      kind: "integer";
      label: string;
      default?: number;
      min?: number;
      max?: number;
      options?: ContractParamOption<number>[];
    };

export type ContractParamOption<T extends ContractParamValue> = {
  label: string;
  value: T;
};

export type ContractParamPreset = {
  label: string;
  value: string;
  params: ContractParams;
};

export type ContractSignalPlanItem =
  | {
      kind: "fixed";
      signals: string[];
    }
  | {
      kind: "conditional";
      param: string;
      signal: string;
    }
  | {
      kind: "bus";
      prefix: string;
      widthParam: string;
      maxWidth: number;
    };

export type ContractSignal = {
  direction: "bidirectional" | "from_to_to" | "to_to_from";
};

export type DiagnosticSeverity = "error" | "warning" | "info";

export type Diagnostic = {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  targets: DiagnosticTarget[];
  suggestions?: Suggestion[];
};

export type DiagnosticTarget =
  | {
      kind: "edge";
      id: string;
    }
  | {
      kind: "node";
      id: string;
    }
  | {
      kind: "pin";
      node: string;
      pin: string;
    };

export type Suggestion = {
  title: string;
  patch: {
    op: "setEdgeBindings";
    edge: string;
    value: SignalBindings;
  };
};

export type ResolvedProject = {
  schema: "nocad.lock.v0";
  sourceSet: {
    hash: string;
    files: Array<{
      role: "project";
      path: string;
      hash: string;
    }>;
  };
  resolver: {
    name: "nocad-resolver";
    version: string;
  };
  dependencies: Record<string, ResolvedDependency>;
  resolvedChoices: ResolvedChoice[];
  nets: ResolvedNet[];
  generated: GeneratedObject[];
  diagnostics: Diagnostic[];
};

export type ResolvedDependency = {
  version: string;
  hash: string;
  introducedBy?: {
    edge: string;
    feature: string;
  };
};

export type ResolvedChoice = {
  id: string;
  sourceEdge: string;
  strategy: "auto" | "manual";
  selected: {
    bindings: SignalBindings;
    params?: ContractParams;
    providerMode?: string;
  };
  reason: string;
};

export type ResolvedNet = {
  id: string;
  name: string;
  endpoints: Record<EndpointRole, EndpointRef>;
  direction: "bidirectional" | "from_to_to" | "to_to_from";
  sourceEdge: string;
  sourceMap: {
    edge: string;
    feature?: string;
    segment?: "connector" | "provider";
    signal: string;
  };
};

export type GeneratedObject = {
  id: string;
  kind: "component";
  component: string;
  value?: string;
  connects: string[];
  sourceEdge: string;
  placementHint?: {
    edge: string;
    near: "connector" | "provider";
  };
  sourceMap: {
    edge: string;
    feature: string;
    signal?: string;
  };
};
