export type EndpointRole = "from" | "to";

export type EndpointRef = {
  node: string;
  pin?: string;
  port?: string;
};

export type SignalBindings = Record<string, Partial<Record<EndpointRole, EndpointRef>>>;

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

export type ProjectNode = ComponentNode | PowerDomainNode;

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

export type PowerDomainNode = GraphObjectMetadata & {
  id: string;
  kind: "powerDomain";
  voltage: string;
};

export type ProjectEdge = IntentConnectionEdge | NetBindingEdge;

export type IntentConnectionEdge = GraphObjectMetadata & {
  id: string;
  kind: "intent.connection";
  from: EndpointRef;
  to: EndpointRef;
  contract: string;
  strategy?: {
    pinAssignment?: "auto" | "manual";
  };
  include?: {
    pullups?: boolean;
  };
  bindings?: SignalBindings;
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
  preferredI2cPairs?: Array<{ sda: string; scl: string }>;
};

export type PinDefinition = {
  name: string;
  capabilities: string[];
};

export type PortDefinition = {
  kind: "fixed_port" | "derived_port" | "pin_pool";
  contractMaps?: Record<string, PortContractMap>;
};

export type PortContractMap = {
  role: EndpointRole;
  signalMap: Record<string, SignalPinMap>;
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
  signals: Record<string, ContractSignal>;
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
  sourceMap: {
    edge: string;
    feature: string;
  };
};
