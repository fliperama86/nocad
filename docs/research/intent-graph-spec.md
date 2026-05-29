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

`project.nocad.lock.json` is generated. It contains concrete resolver decisions such as selected pins, selected part variants, generated nets, inferred components, footprints, BOM mappings, generated design rules, and provenance.

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
- `net.binding`: explicit low-level net binding
- `constraint.appliesTo`: attaches a constraint to a node, port, contract signal, signal bundle, or generated net
- `generation.expandsTo`: links generated objects to their source intent
- `dependency.requires`: declares resolver ordering or design dependency

### Component Definition

A component definition describes what a part exposes. It is not just a symbol and footprint. It includes packages, stable logical pins, package pad mappings, electrical data, capabilities, ports, constraints, layout hints, sourcing data, and optional module-generation rules.

### Port

A port is a named endpoint exposed by a node. It is the surface a connection attaches to.

Examples:

- `mcu.video.pio_dvi`
- `mcu.gpio_bank`
- `hdmi.video.tmds`
- `sensor.i2c`

Ports may be backed by fixed pins, a pool of pins, a derived interface, a generated module, or an internal capability selector.

### Connection Contract

A connection contract is the semantic signal contract for an edge. It may be a built-in contract, a package-provided contract, a project-local contract, or an inline object.

Examples:

- `builtin:i2c.v1`
- `builtin:spi.v1`
- `builtin:usb2.device.v1`
- `builtin:dvi_over_hdmi.v1`
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
- `video.pio_dvi_candidate`

Capabilities let the resolver answer questions like "which RP2350 pins can satisfy this I2C bus?" or "does this package expose enough adjacent GPIOs for this DVI bundle?" In `nocad.project.v0`, capabilities are not edge endpoints. Components expose ports, and ports may use capability selectors internally.

### Stable References

Source and AI patches must address graph objects by stable IDs, not by array index, display label, or package pad number.

Stable references:

```json
{ "node": "mcu", "pin": "gpio12" }
```

```json
{ "edge": "video_out", "signal": "tmds2.p" }
```

Non-stable references:

```json
"mcu.GPIO12"
```

```json
"/edges/1/pins"
```

Physical package pads, user-visible pin names, net labels, and reference designators are properties of stable objects. They can change across packages, imports, renames, or annotation passes, so they should not be used as source-level identity.

Patch operations should prefer semantic targets such as `{ "op": "setEdgeBindings", "edge": "sensor_bus" }` over raw JSON Pointer paths into ordered arrays. Raw JSON Patch can still be an interchange format, but it should be generated after resolving stable IDs to current document paths.

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

For each endpoint role, `contractMaps[contract].signalMap` is the authoritative mapping from contract signals to fixed pins or pin selectors. A port-level `baseSignals` field is only an inventory of native/base signals and must not be used to infer contract mappings.

Example fixed connector port:

```json
{
  "ports": {
    "video.tmds": {
      "kind": "fixed_port",
      "contractMaps": {
        "builtin:dvi_over_hdmi.v1": {
          "role": "to",
          "signalMap": {
            "tmds2.p": { "pin": "tmds_d2_p" },
            "tmds2.n": { "pin": "tmds_d2_n" },
            "hpd": { "pin": "hpd" }
          }
        }
      }
    }
  }
}
```

Example selectable MCU port:

```json
{
  "ports": {
    "video.pio_dvi": {
      "kind": "derived_port",
      "contractMaps": {
        "builtin:dvi_over_hdmi.v1": {
          "role": "from",
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

## Example: RP2350 To HDMI

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
      "package": "QFN80"
    },
    {
      "id": "hdmi",
      "kind": "component",
      "component": "@nocad/connectors:HDMI_TYPE_A_RECEPTACLE",
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
      }
    },
    "routingIntent": [
      {
        "id": "video_escape",
        "appliesTo": "video_out",
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
      "id": "video_out",
      "kind": "intent.connection",
      "from": {
        "node": "mcu",
        "port": "video.pio_dvi"
      },
      "to": {
        "node": "hdmi",
        "port": "video.tmds"
      },
      "contract": "builtin:dvi_over_hdmi.v1",
      "strategy": {
        "pinAssignment": "auto"
      },
      "requirements": {
        "resolution": "640x480@60",
        "colorDepth": "rgb332"
      },
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
      ],
      "preferences": [
        {
          "id": "video_route_priority",
          "kind": "preference",
          "type": "route_priority",
          "weight": 80,
          "value": "high",
          "source": "user"
        }
      ],
      "include": {
        "esdProtection": true,
        "hotPlugDetect": true,
        "ddc": false,
        "cec": false,
        "shield": true
      }
    }
  ],
  "ui": {
    "graph": {
      "nodes": {
        "mcu": { "x": 120, "y": 160 },
        "hdmi": { "x": 520, "y": 160 },
        "video_out": { "x": 320, "y": 160 }
      }
    }
  }
}
```

With manual pin choices:

```json
{
  "id": "video_out",
  "kind": "intent.connection",
  "from": {
    "node": "mcu",
    "port": "video.pio_dvi"
  },
  "to": {
    "node": "hdmi",
    "port": "video.tmds"
  },
  "contract": "builtin:dvi_over_hdmi.v1",
  "strategy": {
    "pinAssignment": "manual"
  },
  "include": {
    "hotPlugDetect": true
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

## Feature Elaboration

`include` flags are inputs to contract elaboration. They are not arbitrary booleans that only affect generated helper parts. A contract must define what each supported feature adds.

For `builtin:dvi_over_hdmi.v1`, the base contract may add TMDS data and clock signals. Optional features can add signals, generated components, constraints, and required pin bindings:

```json
{
  "contract": "builtin:dvi_over_hdmi.v1",
  "features": {
    "hotPlugDetect": {
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
    "esdProtection": {
      "generated": [
        {
          "kind": "component",
          "component": "@nocad/protection:HDMI_ESD_ARRAY"
        }
      ]
    }
  }
}
```

If an edge sets `"hotPlugDetect": true`, the resolver must include the `hpd` signal in candidate generation, manual binding validation, generated nets, diagnostics, and the lockfile. If the feature is false, a manual `hpd` binding should be rejected as unknown or inactive.

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
        { "kind": "video.pio_dvi_candidate" }
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
    "video.pio_dvi": {
      "kind": "derived_port",
      "requires": {
        "basePinCount": 8,
        "capabilities": ["gpio", "pio"],
        "pairing": "adjacent_gpio_pairs"
      },
      "baseSignals": {
        "tmds2.p": {},
        "tmds2.n": {},
        "tmds1.p": {},
        "tmds1.n": {},
        "tmds0.p": {},
        "tmds0.n": {},
        "clock.p": {},
        "clock.n": {}
      },
      "contractMaps": {
        "builtin:dvi_over_hdmi.v1": {
          "role": "from",
          "signalMap": {
            "tmds2.p": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "tmds2.n": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "tmds1.p": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "tmds1.n": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "tmds0.p": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "tmds0.n": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "clock.p": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "clock.n": { "pinSelector": { "capabilities": ["gpio", "pio"] } },
            "hpd": { "pinSelector": { "capabilities": ["gpio"] } }
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

`basePinCount` only describes the port's base signals. The resolver must compute the effective pin count after contract feature elaboration by counting active `contractMaps[contract].signalMap` entries and feature requirements. For example, `builtin:dvi_over_hdmi.v1` needs eight MCU pins for TMDS-only output and nine MCU pins when `hotPlugDetect` is enabled.

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
        "appliesTo": "video_out",
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
  connect mcu.video.pio_dvi -> hdmi.video.tmds

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
      "id": "video_out.pinAssignment",
      "sourceEdge": "video_out",
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
  "sourceEdge": "video_out",
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
    "edge": "video_out",
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
        "edge": "video_out",
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
      "sourceEdge": "video_out",
      "sourceMap": {
        "edge": "video_out",
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
          "sourceEdge": "video_out"
        },
        {
          "id": "net_hdmi_d2_p_impedance",
          "kind": "constraint",
          "type": "differential_impedance",
          "severity": "hard",
          "value": "100ohm",
          "sourceEdge": "video_out",
          "sourceConstraint": "video_impedance"
        },
        {
          "id": "net_hdmi_d2_p_length_match",
          "kind": "constraint",
          "type": "length_match",
          "severity": "hard",
          "value": "0.5mm",
          "sourceEdge": "video_out",
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
      "sourceEdge": "video_out",
      "sourceMap": {
        "edge": "video_out",
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
          "sourceEdge": "video_out"
        },
        {
          "id": "net_hdmi_d2_n_impedance",
          "kind": "constraint",
          "type": "differential_impedance",
          "severity": "hard",
          "value": "100ohm",
          "sourceEdge": "video_out",
          "sourceConstraint": "video_impedance"
        },
        {
          "id": "net_hdmi_d2_n_length_match",
          "kind": "constraint",
          "type": "length_match",
          "severity": "hard",
          "value": "0.5mm",
          "sourceEdge": "video_out",
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
      "sourceEdge": "video_out",
      "sourceMap": {
        "edge": "video_out",
        "signal": "hpd",
        "feature": "hotPlugDetect",
        "layoutIntent": "video_escape"
      }
    }
  ],
  "generated": [
    {
      "id": "hdmi_esd",
      "kind": "component",
      "component": "@nocad/protection:HDMI_ESD_ARRAY",
      "sourceEdge": "video_out",
      "sourceMap": {
        "edge": "video_out",
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
  "message": "mcu.gpio12 is already reserved by video_out.tmds2.p.",
  "targets": [
    { "kind": "edge", "id": "video_out" },
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
- schematic projection
- PCB projection
- component capability browser
- resolved diff
- diagnostics
- generated artifacts

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
