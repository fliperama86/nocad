# Draft Spec: Intent Graph

Status: draft

This document sketches a source format and compiler model for describing electronics projects in nocad as intent graphs. The core idea is that the UI, visual graph editor, AI tools, and import/export flows all operate on one canonical, machine-friendly source document.

The source document describes what the user intends. A resolver compiles that intent into concrete pins, nets, parts, footprints, constraints, generated schematic fragments, PCB rules, BOM entries, and fabrication outputs.

## Goals

- Make project intent explicit, structured, versionable, and safe for tools to edit.
- Let the UI author the project source without requiring users to write code.
- Support visual graph editing, structured inspectors, AI edits, and text review from the same model.
- Represent component capabilities such as multi-function MCU pins without forcing users to constantly reference datasheets.
- Support built-in protocols and user-defined or one-off custom protocols with the same graph primitives.
- Persist resolver decisions so generated projects are stable and reviewable.
- Feed physical placement and routing intent into resolution so pin assignment can optimize for layout quality.
- Keep KiCad compatible as an import/export target without letting KiCad's file model define nocad's internal model.

## Non-Goals

- Do not make the project source an imperative scripting language.
- Do not require every connection to be described as raw nets.
- Do not make built-in protocols a closed enum.
- Do not require users to hand-edit generated resolved data.
- Do not model the schematic canvas as the only source of truth.

## File Model

The canonical authored source is JSON:

```txt
project.nocad.json
```

The resolver output is persisted separately:

```txt
project.nocad.lock.json
```

Optional future import/export formats may include YAML or TypeScript, but they should compile to the same canonical JSON graph. The UI should read and write the JSON source directly or through a deterministic document API.

## Source vs Resolved

`project.nocad.json` is user-authored, usually by the UI. It contains intent, component instances, port and contract references, constraints, manual choices, physical layout intent, and graph layout metadata.

`project.nocad.lock.json` is generated. It contains concrete resolver decisions such as selected pins, selected part variants, generated nets, inferred components, footprints, BOM mappings, generated design rules, reference designator assignments, user-visible label mappings, and provenance.

Users should normally change the source file. If they want to force a resolved choice, the UI should write an explicit override into `project.nocad.json`, then regenerate the lockfile.

## Borrowed Concepts From Unreal Blueprint

nocad should borrow Blueprint's graph-language ideas, not its runtime execution model.

- Typed pins become typed electrical ports, interfaces, capabilities, and signal contracts.
- Nodes become components, modules, constraints, generators, notes, and intent blocks.
- Wires become signal bindings, dependency edges, constraint attachments, and generation relationships.
- Blueprint Interfaces become protocol and interface contracts.
- Collapsed graphs become reusable modules and hierarchical subsystems.
- The Blueprint compiler becomes the nocad resolver.
- Compile errors become linked graph diagnostics with fix suggestions.
- The Details panel becomes a structured inspector for selected nodes, edges, pins, and constraints.
- Construction Script becomes compile-time elaboration, such as expanding a module into components and nets.

The graph should remain mostly declarative. Hardware intent is not an imperative runtime program.

## Core Terms

### Node

A node is an instantiated object in the project graph.

Examples:

- component instance
- module instance
- function intent, such as `HDMI video output`
- connector
- power domain
- generated subsystem
- physical board
- constraint group
- documentation or note anchor

### Edge

An edge relates nodes or ports.

Common edge kinds:

- `intent.connection`: user intent to connect two ports
- `intent.provides`: a concrete component provides or implements a function node
- `intent.exposes`: a function node is exposed through a connector, header, module boundary, or external interface
- `net.binding`: explicit low-level net binding
- `constraint.appliesTo`: attaches a constraint to a node, port, contract signal, signal bundle, or generated net
- `generation.expandsTo`: links generated objects to their source intent
- `dependency.requires`: declares resolver ordering or design dependency

### Function Node

A function node represents a user-facing design function rather than a concrete part.

Examples:

- `HDMI video output`
- `USB device port`
- `sensor I2C bus`
- `battery charger`
- `debug UART`

Function nodes keep high-level intent separate from component-specific implementation details. For example, an HDMI video output function can request TMDS, DDC, HPD, CEC, 5V source power, ESD protection, and series termination without knowing whether the provider is RP2350 HSTX, RP2350 PIO/GPIO, an external HDMI transmitter IC, or a future module.

Function nodes are edited through inspectors like any other node. Typical editable fields are protocol features, user-facing labels, electrical options, generated protection/filtering options, and high-level requirements such as resolution or voltage domain.

Provider-specific choices belong on the edge from the concrete component to the function node, not on the function node itself.

### Component Definition

A component definition describes what a part exposes. It is not just a symbol and footprint. It includes packages, stable logical pins, package pad mappings, electrical data, capabilities, ports, constraints, layout hints, sourcing data, and optional module-generation rules.

### Port

A port is a named endpoint exposed by a node. It is the surface a connection attaches to.

Examples:

- `mcu.video_out`
- `mcu.gpio_bank`
- `hdmi.hdmi_sink`
- `sensor.i2c`

Ports may be backed by fixed pins, a pool of pins, a derived interface, a generated module, or an internal capability selector.

### Provider Mode

A provider mode is a component-defined way to satisfy a function or contract. Rich component packages should expose these modes so users do not need to keep datasheets open.

Examples for an RP2350 package:

- `i2c0_gpio4_gpio5`
- `spi0_default`
- `hstx`
- `pio_gpio_8bit`
- `custom_gpio`

Provider modes live in component definitions. A source edge selects a provider mode through its `strategy`.

```json
{
  "id": "edge_mcu_provides_hdmi",
  "kind": "intent.provides",
  "from": {
    "node": "mcu",
    "port": "video_out"
  },
  "to": {
    "node": "hdmi_output",
    "port": "source"
  },
  "contract": "@nocad/video:hdmi_output.v1",
  "strategy": {
    "providerMode": "hstx",
    "pinAssignment": "auto"
  }
}
```

The target function node does not know what `hstx` means. The RP2350 package defines that mode, its required resources, its pin constraints, and any implementation-specific signal mapping options.

### Connection Contract

A connection contract is the semantic signal contract for an edge. It may be a built-in contract, a package-provided contract, a project-local contract, or an inline object.

Examples:

- `builtin:i2c.v1`
- `builtin:spi.v1`
- `builtin:usb2.device.v1`
- `@nocad/video:hdmi_output.v1`
- `local:rgb_parallel_8bit.v1`
- inline custom contract objects

Contracts define signal names, direction, electrical expectations, optional timing information, feature expansion, and routing constraints. They do not need to imply a standard protocol.

An edge must use `contract` for the connection's semantic contract. Endpoint fields use `from.port` and `to.port` to describe where the contract is being bound. Do not use root-level `interface`; it is ambiguous.

### Capability

A capability is something a component pin, group of pins, or component instance can satisfy.

Examples:

- `gpio`
- `pio`
- `i2c.sda`
- `i2c.scl`
- `spi.sck`
- `uart.tx`
- `pwm.channel`
- `adc.input`
- `video.hdmi_provider_candidate`

Capabilities let the resolver answer questions like "which RP2350 pins can satisfy this I2C bus?" or "does this package expose enough adjacent GPIOs for this DVI bundle?" In `nocad.project.v0`, capabilities are not edge endpoints. Components expose ports, and ports may use capability selectors internally.

### Stable References

Source and AI patches must address graph objects by stable IDs, not by array index, display label, semantic role, reference designator, or package pad number. UI-authored graph object IDs should be generated machine IDs, preferably prefixed UUID/ULID/CUID-style strings such as `node_...` and `edge_...`.

Normal UI surfaces should not expose these internal IDs by default. Graph nodes, inspectors, connection labels, generated objects, and user-facing diagnostics should display `label`, `role`, port names, pin names, and reference designators. Internal IDs are appropriate in raw JSON, debug/provenance inspectors, lockfile review, source maps, and machine patches.

Stable references:

```json
{ "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio12" }
```

```json
{ "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65", "signal": "tmds2.p" }
```

Non-stable references:

```json
"mcu.GPIO12"
```

```json
"U1.GPIO12"
```

```json
"Main MCU.GPIO12"
```

```json
"/edges/1/pins"
```

Physical package pads, semantic roles, user-visible pin names, net labels, and reference designators are properties of stable objects. They can change across packages, imports, renames, or annotation passes, so they should not be used as source-level identity.

Patch operations should prefer semantic targets such as `{ "op": "setEdgeBindings", "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65" }` over raw JSON Pointer paths into ordered arrays. Raw JSON Patch can still be an interchange format, but it should be generated after resolving stable IDs to current document paths.

### Reference Designators And Labels

Reference designators such as `R12`, `U3`, and `C7` are labels, not identity. Net names and user-facing names follow the same rule. They may be regenerated, renumbered, imported, or exported without changing the underlying graph object.

Stable IDs identify authored and generated objects. Labels and roles are metadata:

```json
{
  "id": "gen_aa812a2d-ec03-459b-9e55-7dd0d7ac9bc7",
  "kind": "component",
  "label": "SCL pullup",
  "role": "i2c_pullup",
  "component": "@nocad/passives:RESISTOR",
  "labels": {
    "refdes": "R7"
  },
  "sourceMap": {
    "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
    "feature": "pullups",
    "signal": "scl"
  }
}
```

Short examples in this document may use readable IDs when the surrounding point is unrelated to identity. Persisted UI-authored source must use generated stable IDs while exposing editable names, roles, and reference designators as metadata.

KiCad import should preserve imported reference designators as metadata on stable objects, not as primary keys. KiCad export should use the lockfile's label or reference assignment table to emit KiCad-compatible reference designators.

Users may pin a reference designator when it matters for documentation or assembly, but that pin is still an override on the stable object. AI edits, diagnostics, suggestions, and source maps must target stable IDs and semantic source references, not `R12`-style labels.

### Signal Bindings

All explicit signal-to-pin choices use one canonical field: `bindings`.

`bindings` maps a contract signal to endpoint roles. Endpoint roles are usually `from` and `to`, matching the edge endpoints. Future multi-drop or bus edges may define named endpoint roles, but they should use the same role-keyed object shape.

Full binding:

```json
{
  "bindings": {
    "clk": {
      "from": { "node": "mcu", "pin": "gpio12" },
      "to": { "node": "debug_header", "pin": "p1" }
    }
  }
}
```

Source bindings may be partial when the omitted endpoint role is defined by the selected port's contract map. The resolver fills omitted endpoint roles in the lockfile:

```json
{
  "bindings": {
    "tmds2.p": {
      "from": { "node": "mcu", "pin": "gpio12" }
    }
  }
}
```

Partial bindings are only valid when the selected port declares a contract map for the omitted endpoint role. The resolver must not infer mappings from signal names alone.

Full bindings still validate against the selected ports. For example, a `gpio_bank` port can accept any pin selected by its internal GPIO selector, while a connector `pins` port can accept any stable header pin exposed by that connector.

For each endpoint role, `contractMaps[contract].signalMap` is the authoritative mapping from contract signals to fixed pins or pin selectors. Provider ports use `provides[function].modes[mode].signalMap` for the same purpose. A port-level `baseSignals` field is only an inventory of native/base signals and must not be used to infer contract mappings.

Example fixed connector port:

```json
{
  "ports": {
    "hdmi_sink": {
      "kind": "fixed_port",
      "contractMaps": {
        "@nocad/video:hdmi_output.v1": {
          "role": "to",
          "signalMap": {
            "tmds2.p": { "pin": "tmds_d2_p" },
            "tmds2.n": { "pin": "tmds_d2_n" },
            "ddc.sda": { "pin": "ddc_sda" },
            "ddc.scl": { "pin": "ddc_scl" },
            "hpd": { "pin": "hpd" },
            "cec": { "pin": "cec" },
            "5v": { "pin": "5v" }
          }
        }
      }
    }
  }
}
```

Example selectable MCU provider port:

```json
{
  "ports": {
    "video_out": {
      "kind": "derived_port",
      "provides": {
        "@nocad/video:hdmi_output.v1": {
          "role": "provider",
          "modes": {
            "pio_gpio_8bit": {
              "signalMap": {
                "tmds2.p": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
                "tmds2.n": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
                "hpd": { "pinSelector": { "capabilities": ["gpio"] } }
              }
            }
          }
        }
      }
    }
  }
}
```

The source format should not also use `pinBindings`, signal arrays, or signal-to-string maps.

Signal direction names should refer to endpoint roles, not to overloaded words like source or sink. For a two-endpoint edge, use `from_to_to` when the signal is driven from the `from` endpoint toward the `to` endpoint, and `to_to_from` for the reverse direction.

### Protocol

A protocol is a common kind of connection contract. Protocol references should be open strings or URIs, not closed enums.

Examples:

```json
"contract": "builtin:i2c.v1"
```

```json
"contract": "local:my_weird_debug_bus.v1"
```

For non-standard designs, the project can define a local contract or inline one directly on the edge.

### Constraints And Preferences

Constraints and preferences must be typed records, not arbitrary key/value bags.

Hard constraints reject invalid candidates:

```json
{
  "id": "video_impedance",
  "kind": "constraint",
  "type": "differential_impedance",
  "severity": "hard",
  "value": "100ohm",
  "source": "user"
}
```

Soft preferences score otherwise-valid candidates:

```json
{
  "id": "video_route_priority",
  "kind": "preference",
  "type": "route_priority",
  "weight": 80,
  "value": "high",
  "source": "user"
}
```

The resolver may add generated constraints and preferences, but they must carry provenance back to the source node, edge, feature, package, or layout intent that created them.

## Canonical Source Shape

Minimal project:

```json
{
  "schema": "nocad.project.v0",
  "id": "rp2350-hdmi-demo",
  "name": "RP2350 HDMI Demo",
  "dependencies": {
    "@nocad/rp2350": "0.1.0",
    "@nocad/connectors": "0.1.0"
  },
  "board": {
    "id": "main_board",
    "layers": 4,
    "size": {
      "width": "60mm",
      "height": "40mm"
    }
  },
  "definitions": {
    "contracts": {}
  },
  "layout": {
    "board": "main_board",
    "placements": {},
    "routingIntent": []
  },
  "nodes": [],
  "edges": [],
  "ui": {
    "graph": {
      "nodes": {}
    }
  }
}
```

Top-level fields:

- `schema`: source schema identifier.
- `id`: stable project id.
- `name`: user-facing name.
- `dependencies`: packages that provide components, modules, contracts, footprints, rules, and fabrication data.
- `board`: default board target or board list in future multi-board projects.
- `definitions`: project-local contracts, constraints, modules, and reusable types.
- `layout`: resolver-visible physical placement and routing intent.
- `nodes`: instantiated graph nodes.
- `edges`: relationships between nodes, ports, connection contracts, or constraints.
- `ui`: non-electrical editor state such as graph node positions, collapsed groups, comments, and viewport hints.

## Example: RP2350 To HDMI Function

Authored source:

```json
{
  "schema": "nocad.project.v0",
  "id": "rp2350-hdmi-demo",
  "name": "RP2350 HDMI Demo",
  "dependencies": {
    "@nocad/rp2350": "0.1.0",
    "@nocad/connectors": "0.1.0",
    "@nocad/video": "0.1.0"
  },
  "board": {
    "id": "main_board",
    "layers": 4,
    "size": {
      "width": "60mm",
      "height": "40mm"
    }
  },
  "nodes": [
    {
      "id": "mcu",
      "kind": "component",
      "component": "@nocad/rp2350:RP2350A",
      "package": "QFN80",
      "label": "Main MCU"
    },
    {
      "id": "hdmi_output",
      "kind": "intent.function",
      "function": "@nocad/video:hdmi_output.v1",
      "label": "HDMI video output",
      "requirements": {
        "resolution": "640x480@60",
        "colorDepth": "rgb332"
      },
      "include": {
        "tmds": true,
        "ddc": true,
        "hpd": true,
        "cec": false,
        "source5v": true,
        "seriesTermination": {
          "mode": "auto",
          "value": "270ohm"
        },
        "esdProtection": "recommended",
        "shield": true
      }
    },
    {
      "id": "hdmi",
      "kind": "component",
      "component": "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE",
      "label": "HDMI port",
      "role": "video_output"
    }
  ],
  "layout": {
    "board": "main_board",
    "placements": {
      "mcu": {
        "region": "center",
        "rotation": "auto"
      },
      "hdmi": {
        "edge": "east",
        "orientation": "outward"
      },
      "hdmi_output": {
        "near": "hdmi"
      }
    },
    "routingIntent": [
      {
        "id": "video_escape",
        "appliesTo": "hdmi_output",
        "preferences": [
          {
            "id": "video_escape_avoid_crossings",
            "kind": "preference",
            "type": "avoid_crossings",
            "weight": 90,
            "value": true,
            "source": "layout"
          },
          {
            "id": "video_escape_minimize_vias",
            "kind": "preference",
            "type": "minimize_vias",
            "weight": 70,
            "value": true,
            "source": "layout"
          }
        ]
      }
    ]
  },
  "edges": [
    {
      "id": "mcu_provides_hdmi",
      "kind": "intent.provides",
      "from": {
        "node": "mcu",
        "port": "video_out"
      },
      "to": {
        "node": "hdmi_output",
        "port": "source"
      },
      "contract": "@nocad/video:hdmi_output.v1",
      "strategy": {
        "providerMode": "hstx",
        "pinAssignment": "auto"
      }
    },
    {
      "id": "hdmi_output_to_connector",
      "kind": "intent.exposes",
      "from": {
        "node": "hdmi_output",
        "port": "connector"
      },
      "to": {
        "node": "hdmi",
        "port": "hdmi_sink"
      },
      "contract": "@nocad/video:hdmi_output.v1",
      "constraints": [
        {
          "id": "video_impedance",
          "kind": "constraint",
          "type": "differential_impedance",
          "severity": "hard",
          "value": "100ohm",
          "source": "user"
        },
        {
          "id": "video_length_match",
          "kind": "constraint",
          "type": "length_match",
          "severity": "hard",
          "value": "0.5mm",
          "source": "user"
        }
      ]
    },
    {
      "id": "video_route_priority",
      "kind": "constraint.appliesTo",
      "target": {
        "node": "hdmi_output"
      },
      "preferences": [
        {
          "id": "video_route_priority",
          "kind": "preference",
          "type": "route_priority",
          "weight": 80,
          "value": "high",
          "source": "user"
        }
      ]
    }
  ],
  "ui": {
    "graph": {
      "nodes": {
        "mcu": { "x": 120, "y": 160 },
        "hdmi": { "x": 520, "y": 160 },
        "hdmi_output": { "x": 320, "y": 160 }
      }
    }
  }
}
```

With manual pin choices:

```json
{
  "id": "mcu_provides_hdmi",
  "kind": "intent.provides",
  "from": {
    "node": "mcu",
    "port": "video_out"
  },
  "to": {
    "node": "hdmi_output",
    "port": "source"
  },
  "contract": "@nocad/video:hdmi_output.v1",
  "strategy": {
    "providerMode": "custom_gpio",
    "pinAssignment": "manual"
  },
  "bindings": {
    "tmds2.p": { "from": { "node": "mcu", "pin": "gpio12" } },
    "tmds2.n": { "from": { "node": "mcu", "pin": "gpio13" } },
    "tmds1.p": { "from": { "node": "mcu", "pin": "gpio14" } },
    "tmds1.n": { "from": { "node": "mcu", "pin": "gpio15" } },
    "tmds0.p": { "from": { "node": "mcu", "pin": "gpio16" } },
    "tmds0.n": { "from": { "node": "mcu", "pin": "gpio17" } },
    "clock.p": { "from": { "node": "mcu", "pin": "gpio18" } },
    "clock.n": { "from": { "node": "mcu", "pin": "gpio19" } },
    "hpd": { "from": { "node": "mcu", "pin": "gpio20" } }
  }
}
```

In this model the graph represents the user's intent as:

```txt
RP2350 -> HDMI video output -> HDMI port
```

The HDMI function node owns protocol features such as TMDS, DDC, HPD, CEC, 5V source power, ESD protection, and series termination. The provider edge from RP2350 to the function owns RP2350-specific choices such as HSTX, PIO/GPIO, custom GPIO ranges, and manual pin assignments. The connector edge owns exposure of the function through a physical HDMI receptacle.

## Feature Elaboration

`include` flags are inputs to function or contract elaboration. They are not arbitrary booleans that only affect generated helper parts. A function or contract definition must define what each supported feature adds.

For `@nocad/video:hdmi_output.v1`, the base function may add TMDS data and clock signals. Optional features can add signals, generated components, constraints, topology rules, and required pin bindings:

```json
{
  "function": "@nocad/video:hdmi_output.v1",
  "features": {
    "tmds": {
      "default": true,
      "signals": {
        "tmds2.p": { "direction": "from_to_to", "electrical": "tmds" },
        "tmds2.n": { "direction": "from_to_to", "electrical": "tmds" },
        "tmds1.p": { "direction": "from_to_to", "electrical": "tmds" },
        "tmds1.n": { "direction": "from_to_to", "electrical": "tmds" },
        "tmds0.p": { "direction": "from_to_to", "electrical": "tmds" },
        "tmds0.n": { "direction": "from_to_to", "electrical": "tmds" },
        "clock.p": { "direction": "from_to_to", "electrical": "tmds" },
        "clock.n": { "direction": "from_to_to", "electrical": "tmds" }
      }
    },
    "hpd": {
      "default": true,
      "signals": {
        "hpd": {
          "direction": "to_to_from",
          "electrical": "digital_3v3"
        }
      },
      "requires": {
        "endpointPins": {
          "from": {
            "capability": "gpio"
          },
          "to": {
            "fixedSignal": "hpd"
          }
        }
      }
    },
    "ddc": {
      "default": false,
      "signals": {
        "ddc.sda": { "direction": "bidirectional", "electrical": "open_drain" },
        "ddc.scl": { "direction": "from_to_to", "electrical": "open_drain" }
      }
    },
    "cec": {
      "default": false,
      "signals": {
        "cec": { "direction": "bidirectional", "electrical": "single_wire" }
      }
    },
    "esdProtection": {
      "generated": [
        {
          "kind": "component",
          "component": "@nocad/protection:HDMI_ESD_ARRAY"
        }
      ]
    },
    "seriesTermination": {
      "topologyRules": [
        {
          "kind": "interposer",
          "type": "series",
          "component": "@nocad/passives:RESISTOR",
          "value": {
            "default": "270ohm",
            "range": ["200ohm", "300ohm"]
          },
          "signals": ["tmds*"],
          "perSignalConductor": true,
          "placement": "near_provider"
        }
      ]
    }
  }
}
```

If a function node sets `"hpd": true`, the resolver must include the `hpd` signal in candidate generation, manual binding validation, generated nets, diagnostics, and the lockfile. If the feature is false, a manual `hpd` binding should be rejected as unknown or inactive.

## Generic Topology Rules

Generated passive components, protection devices, level shifters, pullups, filters, and termination parts should be described as generic topology rules. The resolver should not contain hardcoded knowledge that "HDMI needs resistors" or "this connector needs ESD."

Packages may attach rules to functions, contracts, features, provider modes, or component ports. The resolver only needs generic operations:

- match a rule by function, contract, feature, signal selector, endpoint role, or provider mode
- generate an inline or shunt component
- split a net through an interposer when required
- connect generated components to rails or signals
- preserve source maps and reasons
- validate hard rules and score soft recommendations

Example rule:

```json
{
  "id": "hdmi_tmds_series_resistors",
  "kind": "topologyRule",
  "type": "interposer",
  "appliesTo": {
    "function": "@nocad/video:hdmi_output.v1",
    "feature": "seriesTermination",
    "signals": ["tmds*"]
  },
  "interpose": {
    "kind": "series",
    "component": "@nocad/passives:RESISTOR",
    "value": {
      "default": "270ohm",
      "range": ["200ohm", "300ohm"]
    },
    "perSignalConductor": true,
    "placement": "near_provider"
  },
  "severity": "recommended"
}
```

The lockfile should show the generated topology explicitly:

```json
{
  "id": "gen_mcu_provides_hdmi_tmds2_p_series",
  "kind": "component",
  "component": "@nocad/passives:RESISTOR",
  "value": "270ohm",
  "connects": [
    "net_mcu_provides_hdmi_tmds2_p_provider",
    "net_mcu_provides_hdmi_tmds2_p_connector"
  ],
  "sourceMap": {
    "node": "hdmi_output",
    "edge": "mcu_provides_hdmi",
    "feature": "seriesTermination",
    "signal": "tmds2.p"
  }
}
```

## Example: Local Custom Protocol

Non-standard protocols are represented as local connection contracts, not raw untyped wires.

```json
{
  "definitions": {
    "contracts": {
      "local:debug_stream.v1": {
        "kind": "connection_contract",
        "signals": {
          "clk": {
            "direction": "from_to_to",
            "electrical": "digital_3v3",
            "clock": true
          },
          "data": {
            "direction": "from_to_to",
            "electrical": "digital_3v3"
          },
          "valid": {
            "direction": "from_to_to",
            "electrical": "digital_3v3"
          }
        },
        "constraints": [
          {
            "id": "debug_stream_max_frequency",
            "kind": "constraint",
            "type": "max_frequency",
            "severity": "hard",
            "value": "50MHz",
            "source": "user"
          },
          {
            "id": "debug_stream_max_skew",
            "kind": "constraint",
            "type": "max_skew",
            "severity": "hard",
            "value": "1ns",
            "source": "user"
          }
        ],
        "preferences": [
          {
            "id": "debug_stream_route_group",
            "kind": "preference",
            "type": "route_group",
            "weight": 60,
            "value": true,
            "source": "user"
          }
        ]
      }
    }
  },
  "edges": [
    {
      "id": "debug_stream",
      "kind": "intent.connection",
      "contract": "local:debug_stream.v1",
      "from": {
        "node": "mcu",
        "port": "gpio_bank"
      },
      "to": {
        "node": "debug_header",
        "port": "pins"
      },
      "bindings": {
        "clk": {
          "from": { "node": "mcu", "pin": "gpio12" },
          "to": { "node": "debug_header", "pin": "p1" }
        },
        "data": {
          "from": { "node": "mcu", "pin": "gpio13" },
          "to": { "node": "debug_header", "pin": "p2" }
        },
        "valid": {
          "from": { "node": "mcu", "pin": "gpio14" },
          "to": { "node": "debug_header", "pin": "p3" }
        }
      }
    }
  ]
}
```

For quick one-off work, an edge may define an inline contract:

```json
{
  "id": "custom_bus",
  "kind": "intent.connection",
  "from": {
    "node": "mcu",
    "port": "gpio_bank"
  },
  "to": {
    "node": "panel_header",
    "port": "pins"
  },
  "contract": {
    "kind": "connection_contract",
    "name": "panel_sync",
    "signals": {
      "clk": { "clock": true },
      "hsync": {},
      "vsync": {},
      "data0": {},
      "data1": {}
    }
  },
  "constraints": [
    {
      "id": "panel_sync_voltage",
      "kind": "constraint",
      "type": "voltage_domain",
      "severity": "hard",
      "value": "3.3V",
      "source": "user"
    }
  ],
  "preferences": [
    {
      "id": "panel_sync_route_group",
      "kind": "preference",
      "type": "route_group",
      "weight": 50,
      "value": true,
      "source": "user"
    }
  ],
  "bindings": {
    "clk": {
      "from": { "node": "mcu", "pin": "gpio2" },
      "to": { "node": "panel_header", "pin": "p1" }
    },
    "hsync": {
      "from": { "node": "mcu", "pin": "gpio3" },
      "to": { "node": "panel_header", "pin": "p2" }
    },
    "vsync": {
      "from": { "node": "mcu", "pin": "gpio4" },
      "to": { "node": "panel_header", "pin": "p3" }
    },
    "data0": {
      "from": { "node": "mcu", "pin": "gpio5" },
      "to": { "node": "panel_header", "pin": "p4" }
    },
    "data1": {
      "from": { "node": "mcu", "pin": "gpio6" },
      "to": { "node": "panel_header", "pin": "p5" }
    }
  }
}
```

## Component Definition Shape

Component definitions can live in packages or local project definitions. They should expose stable logical pins, package pad mappings, electrical data, capabilities, ports, packages, symbols, footprints, and default constraints.

Example fragment:

```json
{
  "schema": "nocad.component.v0",
  "id": "@nocad/rp2350:RP2350A",
  "kind": "componentDefinition",
  "name": "RP2350A",
  "manufacturer": "Raspberry Pi",
  "pins": {
    "gpio12": {
      "name": "GPIO12",
      "aliases": ["GPIO12"],
      "electrical": {
        "type": "digital_io",
        "voltageDomain": "IOVDD",
        "absoluteMax": "3.6V"
      },
      "capabilities": [
        { "kind": "gpio", "bank": 0 },
        { "kind": "pio", "instances": ["PIO0", "PIO1"] },
        { "kind": "i2c", "instances": ["I2C0"], "roles": ["sda", "scl"] },
        { "kind": "spi", "instances": ["SPI1"], "roles": ["sck", "tx", "rx", "cs"] },
        { "kind": "uart", "instances": ["UART0"], "roles": ["tx", "rx"] },
        { "kind": "pwm", "slice": 6, "channel": "A" },
        { "kind": "video.hdmi_provider_candidate" }
      ]
    }
  },
  "packages": {
    "QFN80": {
      "symbol": "MCU_RaspberryPi:RP2350A",
      "footprint": "Package_DFN_QFN:QFN-80-1EP_10x10mm_P0.4mm_EP6.8x6.8mm",
      "pads": {
        "gpio12": {
          "pad": "13",
          "side": "east"
        }
      }
    }
  },
  "ports": {
    "gpio_bank": {
      "kind": "pin_pool",
      "selector": {
        "capability": "gpio"
      }
    },
    "video_out": {
      "kind": "derived_port",
      "provides": {
        "@nocad/video:hdmi_output.v1": {
          "role": "provider",
          "modes": {
            "hstx": {
              "label": "HSTX",
              "requires": {
                "peripherals": ["hstx"],
                "pinGroup": "rp2350_hstx_default"
              },
              "signalMap": {
                "tmds2.p": { "pin": "gpio12" },
                "tmds2.n": { "pin": "gpio13" },
                "tmds1.p": { "pin": "gpio14" },
                "tmds1.n": { "pin": "gpio15" },
                "tmds0.p": { "pin": "gpio16" },
                "tmds0.n": { "pin": "gpio17" },
                "clock.p": { "pin": "gpio18" },
                "clock.n": { "pin": "gpio19" },
                "hpd": { "pinSelector": { "capabilities": ["gpio"] } },
                "ddc.sda": { "pinSelector": { "capabilities": ["i2c.sda", "gpio"] } },
                "ddc.scl": { "pinSelector": { "capabilities": ["i2c.scl", "gpio"] } }
              }
            },
            "pio_gpio_8bit": {
              "label": "PIO/GPIO",
              "requires": {
                "peripherals": ["pio"],
                "pinSelector": {
                  "count": 8,
                  "capabilities": ["gpio", "pio"],
                  "contiguous": true
                }
              }
            },
            "custom_gpio": {
              "label": "Custom GPIO",
              "signalMap": {
                "tmds2.p": { "pinSelector": { "capabilities": ["gpio"] } },
                "tmds2.n": { "pinSelector": { "capabilities": ["gpio"] } },
                "tmds1.p": { "pinSelector": { "capabilities": ["gpio"] } },
                "tmds1.n": { "pinSelector": { "capabilities": ["gpio"] } },
                "tmds0.p": { "pinSelector": { "capabilities": ["gpio"] } },
                "tmds0.n": { "pinSelector": { "capabilities": ["gpio"] } },
                "clock.p": { "pinSelector": { "capabilities": ["gpio"] } },
                "clock.n": { "pinSelector": { "capabilities": ["gpio"] } },
                "hpd": { "pinSelector": { "capabilities": ["gpio"] } }
              }
            }
          }
        }
      }
    }
  },
  "constraints": [
    {
      "id": "dvdd_required",
      "kind": "constraint",
      "type": "power_pin_voltage",
      "severity": "hard",
      "pin": "dvdd",
      "voltage": "1.1V",
      "source": "package"
    },
    {
      "id": "iovdd_required",
      "kind": "constraint",
      "type": "power_pin_voltage",
      "severity": "hard",
      "pin": "iovdd",
      "voltage": "3.3V",
      "source": "package"
    },
    {
      "id": "iovdd_decoupling",
      "kind": "constraint",
      "type": "decoupling",
      "severity": "hard",
      "rail": "IOVDD",
      "capacitance": "100nF",
      "nearEachPowerPin": true,
      "source": "package"
    }
  ]
}
```

Provider modes can be as rich as the component package can justify. RP2350 can expose I2C, SPI, UART, PIO, HSTX, PWM, ADC, and custom GPIO modes. That richness is useful, but it belongs to the component package. Function nodes and connector packages should remain generic.

For provider modes with variable signal sets, the resolver must compute the effective pin and resource requirements after function feature elaboration. For example, `@nocad/video:hdmi_output.v1` needs eight provider pins for TMDS-only output, one more provider GPIO when `hpd` is enabled, and DDC-capable pins when `ddc` is enabled.

This makes MCU pin multiplexing queryable by the UI and resolver. For example, the UI can show valid I2C SDA/SCL choices, hide invalid pins, and explain conflicts with other reservations.

## Physical Placement And Layout Feedback

Pin assignment depends on physical layout. For parts with flexible pin muxing, the best logical assignment is often the one that reduces crossings, improves escape routing, shortens critical paths, or keeps differential pairs coherent near the connector.

The resolver should therefore accept physical layout intent as an input, even before nocad has a full PCB layout system.

Layout intent is distinct from graph editor layout:

- graph layout says where nodes appear in the visual intent editor
- physical layout intent says where components, board edges, keepouts, route corridors, and priority regions exist on the PCB

In `nocad.project.v0`, physical placement has one canonical source of truth: `layout.placements`. Component nodes may carry role or packaging metadata, but they should not also carry resolver-visible physical placement. Importers may temporarily read legacy or foreign node-local placement, but they must normalize it into `layout.placements` before resolution. If two authored sources provide contradictory physical placement for the same node, the resolver should produce a diagnostic instead of merging silently.

Early source may keep physical layout intent inside `project.nocad.json`:

```json
{
  "layout": {
    "board": "main_board",
    "placements": {
      "mcu": {
        "region": "center",
        "rotation": "auto"
      },
      "hdmi": {
        "edge": "east",
        "orientation": "outward"
      }
    },
    "routingIntent": [
      {
        "id": "video_escape",
        "appliesTo": "hdmi_output",
        "preferences": [
          {
            "id": "video_escape_prefer_top",
            "kind": "preference",
            "type": "prefer_layer",
            "weight": 40,
            "value": "top",
            "source": "layout"
          },
          {
            "id": "video_escape_avoid_crossings",
            "kind": "preference",
            "type": "avoid_crossings",
            "weight": 90,
            "value": true,
            "source": "layout"
          },
          {
            "id": "video_escape_minimize_vias",
            "kind": "preference",
            "type": "minimize_vias",
            "weight": 70,
            "value": true,
            "source": "layout"
          }
        ]
      }
    ]
  }
}
```

If layout grows large or needs independent editing history, it can become a sibling source document:

```txt
project.nocad.json
project.nocad.layout.json
project.nocad.lock.json
```

When sibling source documents participate in resolution, the lockfile must record each source file path and hash, plus a combined source-set hash. An embedded `layout` object is covered by the project file hash; a sibling `project.nocad.layout.json` is not.

The important contract is that layout intent is still authored input, not generated lockfile data. The resolver can use it to score otherwise-valid choices.

Example scoring problem:

```txt
Source intent:
  provide mcu.video_out -> hdmi_output, expose hdmi_output -> hdmi.hdmi_sink

Candidate A:
  GPIO12..GPIO19
  score: 82
  reason: lowest crossings to east-edge HDMI connector

Candidate B:
  GPIO2..GPIO9
  score: 61
  reason: shorter MCU escape, but two lane swaps near connector

Candidate C:
  GPIO20..GPIO27
  score: rejected
  reason: conflicts with SWD/debug reservation
```

The lockfile should record the selected assignment and enough rationale to make diffs reviewable:

```json
{
  "resolvedChoices": [
    {
      "id": "mcu_provides_hdmi.pinAssignment",
      "sourceEdge": "mcu_provides_hdmi",
      "strategy": "auto",
      "selected": {
        "bindings": {
          "tmds2.p": {
            "from": { "node": "mcu", "pin": "gpio12" },
            "to": { "node": "hdmi", "pin": "tmds_d2_p" }
          },
          "tmds2.n": {
            "from": { "node": "mcu", "pin": "gpio13" },
            "to": { "node": "hdmi", "pin": "tmds_d2_n" }
          },
          "tmds1.p": {
            "from": { "node": "mcu", "pin": "gpio14" },
            "to": { "node": "hdmi", "pin": "tmds_d1_p" }
          },
          "tmds1.n": {
            "from": { "node": "mcu", "pin": "gpio15" },
            "to": { "node": "hdmi", "pin": "tmds_d1_n" }
          },
          "tmds0.p": {
            "from": { "node": "mcu", "pin": "gpio16" },
            "to": { "node": "hdmi", "pin": "tmds_d0_p" }
          },
          "tmds0.n": {
            "from": { "node": "mcu", "pin": "gpio17" },
            "to": { "node": "hdmi", "pin": "tmds_d0_n" }
          },
          "clock.p": {
            "from": { "node": "mcu", "pin": "gpio18" },
            "to": { "node": "hdmi", "pin": "tmds_clk_p" }
          },
          "clock.n": {
            "from": { "node": "mcu", "pin": "gpio19" },
            "to": { "node": "hdmi", "pin": "tmds_clk_n" }
          },
          "hpd": {
            "from": { "node": "mcu", "pin": "gpio20" },
            "to": { "node": "hdmi", "pin": "hpd" }
          }
        }
      },
      "score": 82,
      "inputs": {
        "placementIntent": ["mcu", "hdmi"],
        "routingIntent": ["video_escape"]
      },
      "reason": "Selected adjacent GPIO bundle with lowest estimated crossings to east-edge HDMI connector."
    }
  ]
}
```

This creates a feedback loop:

```txt
authored circuit intent
  + authored physical layout intent
  -> resolver candidate generation
  -> routing and placement cost estimate
  -> selected pin assignment
  -> generated nets and PCB constraints
  -> lockfile
```

The first implementation does not need a real autorouter. A simple geometric cost model is enough to prove the architecture:

- component edge or region hints
- package pin side/position metadata
- connector orientation
- estimated ratsnest crossings
- rough route length
- via penalty
- differential pair adjacency bonus
- conflict penalty for reserved pins

As PCB layout matures, this same contract can consume richer placement data, partial manual routes, keepouts, route channels, layer preferences, and previous layout state.

## Related Compiler Patterns

Several existing tool families have useful patterns for layout-aware resolution.

### FPGA Constraint Closure

FPGA flows separate logical design from implementation constraints. A design is compiled with pin constraints, IO-bank rules, timing constraints, and floorplanning hints. The compiler produces placement, routing, timing reports, and diagnostics. Users then refine the constraints until the design closes.

nocad can use a similar loop:

```txt
intent graph
  + pin constraints
  + placement intent
  + routing constraints
  -> resolver
  -> lockfile
  -> diagnostics and reports
  -> source-level constraint edits
```

This suggests a clear split between hard constraints and soft preferences:

- hard constraints reject invalid candidates, such as voltage mismatch, unavailable package pins, invalid differential pair members, or reserved debug pins
- soft preferences score valid candidates, such as shorter estimated routes, fewer crossings, fewer vias, better connector escape, or preferred board region

### PCB Back-Annotation

Traditional PCB layout tools often support pin swapping or gate swapping during layout, then back-annotating the result to the schematic. The useful idea is that physical layout can discover a better logical assignment.

nocad should make this reviewable and source-level. Layout should propose changes to the authored graph rather than silently mutating generated files.

```txt
layout discovers better pin assignment
  -> resolver emits suggestion
  -> user accepts source patch
  -> project.nocad.json changes
  -> lockfile regenerates
```

Example suggestion:

```json
{
  "kind": "suggestion.pinAssignment",
  "sourceEdge": "mcu_provides_hdmi",
  "reason": "Reduces estimated crossings near the HDMI connector from 6 to 1.",
  "patch": {
    "strategy": {
      "pinAssignment": "manual"
    },
    "bindings": {
      "tmds2.p": { "from": { "node": "mcu", "pin": "gpio16" } },
      "tmds2.n": { "from": { "node": "mcu", "pin": "gpio17" } },
      "tmds1.p": { "from": { "node": "mcu", "pin": "gpio18" } },
      "tmds1.n": { "from": { "node": "mcu", "pin": "gpio19" } }
    }
  }
}
```

### Graph Compiler Source Maps

Procedural graph tools and visual scripting systems commonly distinguish authored graph nodes from expanded compiled artifacts. nocad should keep the same distinction.

Generated symbols, nets, constraints, footprints, and routes should carry source references back to the authored node, edge, contract signal, or layout intent that produced them. This makes diagnostics, AI explanations, diffs, and user review much easier.

Example:

```json
{
  "id": "net_hdmi_d2_p",
  "name": "HDMI_D2_P",
  "endpoints": {
    "from": { "node": "mcu", "pin": "gpio12", "packagePad": "13" },
    "to": { "node": "hdmi", "pin": "tmds_d2_p" }
  },
  "direction": "from_to_to",
  "sourceMap": {
    "edge": "mcu_provides_hdmi",
    "signal": "tmds2.p",
    "layoutIntent": "video_escape"
  }
}
```

This also implies the UI should expose intermediate compiler views:

- candidate pin assignments
- rejected candidates and reasons
- estimated ratsnest and crossing cost
- generated nets
- generated schematic fragments
- generated PCB rules
- source maps from generated artifacts back to graph intent

## Resolved Lockfile Shape

The lockfile records the exact result of resolution.

Resolved nets should keep endpoint-role order from the source edge. Use `endpoints.from` and `endpoints.to` for the edge roles, then encode electrical direction separately with `direction`. Do not reorder `from` and `to` to mean driver and receiver.

The lockfile must record every input that affects deterministic replay: source files, resolver version, directly requested dependencies, transitive dependencies loaded by those packages, and packages introduced by feature elaboration or generation.

Example fragment:

```json
{
  "schema": "nocad.lock.v0",
  "sourceSet": {
    "hash": "sha256:...",
    "files": [
      {
        "role": "project",
        "path": "project.nocad.json",
        "hash": "sha256:..."
      }
    ]
  },
  "resolver": {
    "name": "nocad-resolver",
    "version": "0.1.0"
  },
  "dependencies": {
    "@nocad/rp2350": {
      "version": "0.1.0",
      "hash": "sha256:..."
    },
    "@nocad/connectors": {
      "version": "0.1.0",
      "hash": "sha256:..."
    },
    "@nocad/video": {
      "version": "0.1.0",
      "hash": "sha256:..."
    },
    "@nocad/protection": {
      "version": "0.1.0",
      "hash": "sha256:...",
      "introducedBy": {
        "edge": "mcu_provides_hdmi",
        "feature": "esdProtection"
      }
    }
  },
  "nodes": [
    {
      "id": "mcu",
      "sourceNode": "mcu",
      "component": "@nocad/rp2350:RP2350A",
      "package": "QFN80",
      "labels": {
        "refdes": "U1"
      },
      "symbol": "MCU_RaspberryPi:RP2350A",
      "footprint": "Package_DFN_QFN:QFN-80-1EP_10x10mm_P0.4mm_EP6.8x6.8mm"
    }
  ],
  "nets": [
    {
      "id": "net_hdmi_d2_p",
      "name": "HDMI_D2_P",
      "endpoints": {
        "from": { "node": "mcu", "pin": "gpio12", "packagePad": "13" },
        "to": { "node": "hdmi", "pin": "tmds_d2_p" }
      },
      "direction": "from_to_to",
      "sourceEdge": "mcu_provides_hdmi",
      "sourceMap": {
        "edge": "mcu_provides_hdmi",
        "signal": "tmds2.p",
        "layoutIntent": "video_escape"
      },
      "constraints": [
        {
          "id": "net_hdmi_d2_p_pair",
          "kind": "constraint",
          "type": "differential_pair",
          "severity": "hard",
          "pair": "HDMI_D2",
          "sourceEdge": "mcu_provides_hdmi"
        },
        {
          "id": "net_hdmi_d2_p_impedance",
          "kind": "constraint",
          "type": "differential_impedance",
          "severity": "hard",
          "value": "100ohm",
          "sourceEdge": "mcu_provides_hdmi",
          "sourceConstraint": "video_impedance"
        },
        {
          "id": "net_hdmi_d2_p_length_match",
          "kind": "constraint",
          "type": "length_match",
          "severity": "hard",
          "value": "0.5mm",
          "sourceEdge": "mcu_provides_hdmi",
          "sourceConstraint": "video_length_match"
        }
      ]
    },
    {
      "id": "net_hdmi_d2_n",
      "name": "HDMI_D2_N",
      "endpoints": {
        "from": { "node": "mcu", "pin": "gpio13", "packagePad": "14" },
        "to": { "node": "hdmi", "pin": "tmds_d2_n" }
      },
      "direction": "from_to_to",
      "sourceEdge": "mcu_provides_hdmi",
      "sourceMap": {
        "edge": "mcu_provides_hdmi",
        "signal": "tmds2.n",
        "layoutIntent": "video_escape"
      },
      "constraints": [
        {
          "id": "net_hdmi_d2_n_pair",
          "kind": "constraint",
          "type": "differential_pair",
          "severity": "hard",
          "pair": "HDMI_D2",
          "sourceEdge": "mcu_provides_hdmi"
        },
        {
          "id": "net_hdmi_d2_n_impedance",
          "kind": "constraint",
          "type": "differential_impedance",
          "severity": "hard",
          "value": "100ohm",
          "sourceEdge": "mcu_provides_hdmi",
          "sourceConstraint": "video_impedance"
        },
        {
          "id": "net_hdmi_d2_n_length_match",
          "kind": "constraint",
          "type": "length_match",
          "severity": "hard",
          "value": "0.5mm",
          "sourceEdge": "mcu_provides_hdmi",
          "sourceConstraint": "video_length_match"
        }
      ]
    },
    {
      "id": "net_hdmi_hpd",
      "name": "HDMI_HPD",
      "endpoints": {
        "from": { "node": "mcu", "pin": "gpio20" },
        "to": { "node": "hdmi", "pin": "hpd" }
      },
      "direction": "to_to_from",
      "sourceEdge": "mcu_provides_hdmi",
      "sourceMap": {
        "edge": "mcu_provides_hdmi",
        "signal": "hpd",
        "feature": "hpd",
        "layoutIntent": "video_escape"
      }
    }
  ],
  "generated": [
    {
      "id": "hdmi_esd",
      "kind": "component",
      "component": "@nocad/protection:HDMI_ESD_ARRAY",
      "labels": {
        "refdes": "D1"
      },
      "sourceEdge": "mcu_provides_hdmi",
      "sourceMap": {
        "edge": "mcu_provides_hdmi",
        "feature": "esdProtection"
      },
      "reason": "External HDMI connector requested ESD protection"
    }
  ],
  "diagnostics": []
}
```

The lockfile should be deterministic for a given source set, resolver version, dependency set, and environment-independent resolver configuration.

## Diagnostics

Diagnostics should point back to graph objects, not just generated files.

Example:

```json
{
  "severity": "error",
  "code": "PIN_CONFLICT",
  "message": "mcu.gpio12 is already reserved by mcu_provides_hdmi.tmds2.p.",
  "targets": [
    { "kind": "edge", "id": "mcu_provides_hdmi" },
    { "kind": "edge", "id": "sensor_bus" },
    { "kind": "pin", "node": "mcu", "pin": "gpio12" }
  ],
  "suggestions": [
    {
      "title": "Move I2C to GPIO4/GPIO5",
      "patch": {
        "op": "setEdgeBindings",
        "edge": "sensor_bus",
        "value": {
          "sda": { "from": { "node": "mcu", "pin": "gpio4" } },
          "scl": { "from": { "node": "mcu", "pin": "gpio5" } }
        }
      }
    }
  ]
}
```

Diagnostics should be used by:

- graph overlays
- inspector messages
- AI review
- command palette fixes
- CI or pre-fabrication checks

## UI Requirements

The UI should treat the source graph as the document model.

Required graph behaviors:

- component nodes expose typed ports, contract compatibility, pin pools, and capabilities
- function nodes expose protocol-level requirements and feature toggles
- provider edges expose component-specific modes and pin assignment controls
- connections validate compatibility as the user drags wires
- invalid connections can still be explored when useful, but must show reasons
- inspectors edit structured node and edge properties
- custom contracts can be created from the UI without writing JSON by hand
- auto-resolved choices can be pinned as source-level overrides
- conflicts should be explained in terms of user intent and physical pins
- generated data should be reviewable but visually distinct from authored source
- graph layout metadata should not affect electrical resolution
- physical layout intent should affect pin assignment and other placement-sensitive resolver choices

Suggested views:

- intent graph
- selected-object properties inspector
- schematic projection
- PCB projection
- component capability browser
- resolved diff
- diagnostics
- generated artifacts

The properties inspector should be driven by the selected graph object:

- component node: labels, package, placement hints, exposed ports, and component-specific capabilities
- function node: function requirements and features such as DDC, HPD, CEC, source 5V, ESD, and termination
- provider edge: provider mode, resource selection, pin assignment, and manual bindings
- connector/exposure edge: connector mapping, shell/shield handling, and external-interface constraints
- generated object: provenance, generated reason, and source-map links, but not direct source editing unless the UI creates an explicit override

## Resolver Pipeline

Initial pipeline:

```txt
source JSON
  -> schema validation
  -> dependency loading
  -> component/port/contract expansion
  -> capability matching
  -> physical layout intent loading
  -> candidate generation
  -> constraint solving and layout-aware scoring
  -> generated component insertion
  -> concrete pin/net assignment
  -> schematic projection
  -> PCB rule projection
  -> BOM/fabrication projection
  -> lockfile
```

The resolver should be able to run incrementally. A UI edit should trigger enough resolution to show immediate compatibility, conflicts, and preview changes without requiring a full artifact export.

## Override Model

Automatic choices should be expressible as strategies:

```json
{
  "strategy": {
    "providerMode": "auto",
    "pinAssignment": "auto",
    "partSelection": "prefer_jlcpcb_basic",
    "placement": "auto"
  }
}
```

Pinned user choices should live in source:

```json
{
  "strategy": {
    "providerMode": "i2c0_gpio4_gpio5",
    "pinAssignment": "manual"
  },
  "bindings": {
    "sda": { "from": { "node": "mcu", "pin": "gpio4" } },
    "scl": { "from": { "node": "mcu", "pin": "gpio5" } }
  }
}
```

The resolver may still reject manual choices if they violate hard electrical or package constraints, but it should explain the reason and offer alternatives where possible.

## Schema And Migration

Each source file must declare a schema:

```json
"schema": "nocad.project.v0"
```

Schema evolution should be handled through explicit migrations. The UI should preserve unknown fields where possible, but only schema-known fields should participate in resolution.

Recommended early schemas:

- `nocad.project.v0`
- `nocad.lock.v0`
- `nocad.component.v0`
- `nocad.contract.v0`
- `nocad.module.v0`

## Open Questions

- Should `board` be singular in `v0`, or should the source start with `boards` to avoid a later multi-board migration?
- How much UI state belongs in `project.nocad.json` versus a separate local workspace file?
- Should physical layout intent live inside `project.nocad.json`, or should it start as `project.nocad.layout.json`?
- What is the smallest useful routing cost model for layout-aware pin assignment?
- Should custom inline contracts be promoted automatically into `definitions.contracts` once reused?
- How should analog constraints be represented without overfitting to digital bus examples?
- How much of the resolved lockfile should be committed by default?
- What is the minimum useful component definition for early import from KiCad libraries?
- Should package versions be semver-only, content-addressed, or both?
- How should AI-generated edits record provenance in source and lockfile?

## Initial Implementation Slice

The smallest useful slice:

1. JSON Schema for `project.nocad.json`.
2. JSON Schema for component definitions with stable pins, package pads, capabilities, and ports.
3. Minimal in-memory graph model.
4. Resolver that validates node references and simple contract compatibility.
5. RP2350 component fixture with multi-capability GPIO pins.
6. HDMI connector fixture.
7. I2C fixture to prove pin conflict and suggestion diagnostics.
8. Lockfile writer with selected pins and generated nets.
9. UI capability browser that shows available pins and reasons for invalid choices.
