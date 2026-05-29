# I2C Vertical Slice Plan

Status: draft

This plan defines a small end-to-end feature slice for proving the intent graph model across source data, resolver logic, generated output, diagnostics, and UI.

The goal is not to build a complete electronics compiler. The goal is to make one narrow workflow real enough that the architecture has to touch most of the layers.

## Slice

Feature:

```txt
RP2350 -> I2C temperature sensor
```

Contract:

```txt
builtin:i2c.v1
```

Signals:

```txt
sda
scl
```

Expected resolver behavior:

- validate source graph nodes and edge endpoints
- match both endpoint ports against `builtin:i2c.v1`
- auto-select valid RP2350 pins
- emit lockfile-style resolved bindings
- generate I2C pullup resistors
- emit diagnostics for conflicts or invalid graph references

Expected UI behavior:

- start from a blank graph editor canvas
- add known components from a small palette
- connect components by drawing a graph edge from RP2350 to the sensor
- keep the graph editor separate from diagnostics and raw JSON
- show labels, roles, ports, and pins in normal UI instead of internal IDs
- show resolved bindings
- show generated pullups
- show diagnostics
- allow clearing the canvas, loading the sample graph, and toggling a simple conflict scenario

## Example Source

The app should start from a blank source. The following source is the reset-sample state used to prove the resolver path end to end.

Authored nodes and edges use generated machine IDs. User-facing names, semantic roles, and future schematic annotations live in separate fields such as `label`, `role`, and `refdesHint`.

The normal graph UI should not show these machine IDs. They are visible only in raw JSON, source maps, diagnostics internals, and debug/provenance views.

```json
{
  "schema": "nocad.project.v0",
  "id": "rp2350-i2c-slice",
  "name": "RP2350 I2C Slice",
  "dependencies": {
    "@nocad/rp2350": "0.1.0",
    "@nocad/sensors": "0.1.0"
  },
  "board": {
    "id": "main_board",
    "layers": 2,
    "size": {
      "width": "50mm",
      "height": "30mm"
    }
  },
  "layout": {
    "board": "main_board",
    "placements": {},
    "routingIntent": []
  },
  "nodes": [
    {
      "id": "node_77e9d1da-e4da-45d5-b60f-3bb8d41f63f1",
      "kind": "powerDomain",
      "label": "3V3 rail",
      "role": "power_3v3",
      "voltage": "3.3V"
    },
    {
      "id": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12",
      "kind": "component",
      "label": "Main MCU",
      "role": "mcu",
      "component": "@nocad/rp2350:RP2350A",
      "package": "QFN80",
      "refdesHint": "U?"
    },
    {
      "id": "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb",
      "kind": "component",
      "label": "Temperature sensor",
      "role": "temperature_sensor",
      "component": "@nocad/sensors:I2C_TEMP_SENSOR",
      "refdesHint": "U?"
    }
  ],
  "edges": [
    {
      "id": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
      "kind": "intent.connection",
      "label": "Sensor I2C bus",
      "role": "sensor_bus",
      "from": {
        "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12",
        "port": "i2c"
      },
      "to": {
        "node": "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb",
        "port": "i2c"
      },
      "contract": "builtin:i2c.v1",
      "strategy": {
        "pinAssignment": "auto"
      },
      "include": {
        "pullups": true
      }
    }
  ]
}
```

Editor node positions are UI state for this slice. They should not be written into `project.nocad.json` until the placement/layout model is introduced.

## Expected Resolved Output

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
    "@nocad/sensors": {
      "version": "0.1.0",
      "hash": "sha256:..."
    },
    "@nocad/passives": {
      "version": "0.1.0",
      "hash": "sha256:...",
      "introducedBy": {
        "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
        "feature": "pullups"
      }
    }
  },
  "resolvedChoices": [
    {
      "id": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65.pinAssignment",
      "sourceEdge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
      "strategy": "auto",
      "selected": {
        "bindings": {
          "sda": {
            "from": { "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio4" },
            "to": { "node": "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb", "pin": "sda" }
          },
          "scl": {
            "from": { "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio5" },
            "to": { "node": "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb", "pin": "scl" }
          }
        }
      },
      "reason": "Selected first available I2C-capable RP2350 pin pair."
    }
  ],
  "nets": [
    {
      "id": "net_edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65_sda",
      "name": "I2C_SDA",
      "endpoints": {
        "from": { "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio4" },
        "to": { "node": "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb", "pin": "sda" }
      },
      "direction": "bidirectional",
      "sourceEdge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
      "sourceMap": {
        "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
        "signal": "sda"
      }
    },
    {
      "id": "net_edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65_scl",
      "name": "I2C_SCL",
      "endpoints": {
        "from": { "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio5" },
        "to": { "node": "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb", "pin": "scl" }
      },
      "direction": "bidirectional",
      "sourceEdge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
      "sourceMap": {
        "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
        "signal": "scl"
      }
    }
  ],
  "generated": [
    {
      "id": "pullup_edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65_sda",
      "kind": "component",
      "component": "@nocad/passives:RESISTOR",
      "value": "4.7k",
      "connects": ["net_edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65_sda", "node_77e9d1da-e4da-45d5-b60f-3bb8d41f63f1"],
      "sourceEdge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
      "sourceMap": {
        "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
        "feature": "pullups",
        "signal": "sda"
      }
    },
    {
      "id": "pullup_edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65_scl",
      "kind": "component",
      "component": "@nocad/passives:RESISTOR",
      "value": "4.7k",
      "connects": ["net_edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65_scl", "node_77e9d1da-e4da-45d5-b60f-3bb8d41f63f1"],
      "sourceEdge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
      "sourceMap": {
        "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
        "feature": "pullups",
        "signal": "scl"
      }
    }
  ],
  "diagnostics": []
}
```

## Implementation Steps

### 1. Add Core Intent Package

Create a UI-independent package:

```txt
packages/intent-core
```

Initial contents:

- source graph types
- component definition types
- contract definition types
- resolved project types
- diagnostic and suggestion types
- resolver entry point

This package must not import React, Electron, or browser-only APIs.

### 2. Add Minimal Fixtures

Add fixture data in `packages/intent-core`.

Required component fixtures:

- `@nocad/rp2350:RP2350A`
- `@nocad/sensors:I2C_TEMP_SENSOR`
- `@nocad/passives:RESISTOR`

Required contract fixture:

- `builtin:i2c.v1`

Minimal RP2350 pins:

- `gpio4`
- `gpio5`
- `gpio8`
- `gpio9`

The resolver should treat `gpio4/gpio5` as the first preferred I2C pair and `gpio8/gpio9` as the fallback pair.

Fixture ports must use `contractMaps` so the resolver proves the intent model instead of hard-coding I2C signal names.

RP2350 `i2c` port:

```json
{
  "ports": {
    "i2c": {
      "kind": "derived_port",
      "contractMaps": {
        "builtin:i2c.v1": {
          "role": "from",
          "signalMap": {
            "sda": { "pinSelector": { "capabilities": ["i2c.sda", "gpio"] } },
            "scl": { "pinSelector": { "capabilities": ["i2c.scl", "gpio"] } }
          }
        }
      }
    }
  }
}
```

Temperature sensor `i2c` port:

```json
{
  "ports": {
    "i2c": {
      "kind": "fixed_port",
      "contractMaps": {
        "builtin:i2c.v1": {
          "role": "to",
          "signalMap": {
            "sda": { "pin": "sda" },
            "scl": { "pin": "scl" }
          }
        }
      }
    }
  }
}
```

### 3. Implement Resolver

Resolver responsibilities:

- validate node ids are unique
- validate edge ids are unique
- validate edge node references
- validate endpoint ports exist
- validate both ports support the edge contract
- generate candidate pin bindings
- respect existing pin reservations
- select a deterministic valid candidate
- generate nets
- generate pullups when requested
- emit diagnostics for invalid input or conflicts

The first resolver can be deterministic and simple. It does not need layout scoring yet.

### 4. Add Conflict Scenario

Add a sample source variant where `node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12.gpio4` is already reserved.

Concrete source variant:

```json
{
  "edges": [
    {
      "id": "edge_1f7596a2-8ee5-4f44-8b55-479597a1e602",
      "kind": "net.binding",
      "label": "Debug GPIO reservation",
      "role": "debug_gpio",
      "bindings": {
        "debug": {
          "from": { "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio4" }
        }
      }
    },
    {
      "id": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
      "kind": "intent.connection",
      "label": "Sensor I2C bus",
      "role": "sensor_bus",
      "from": {
        "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12",
        "port": "i2c"
      },
      "to": {
        "node": "node_6ff18f46-bd9c-49c8-8e7c-dcb2202359fb",
        "port": "i2c"
      },
      "contract": "builtin:i2c.v1",
      "strategy": {
        "pinAssignment": "auto"
      },
      "include": {
        "pullups": true
      }
    }
  ]
}
```

Expected behavior:

- resolver should not assign `edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65.sda` to `gpio4`
- resolver should choose `gpio8/gpio9` if available
- if no fallback pair exists, resolver should emit a diagnostic with a stable semantic patch suggestion

Example diagnostic:

```json
{
  "severity": "error",
  "code": "PIN_CONFLICT",
  "message": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12.gpio4 is already reserved.",
  "targets": [
    { "kind": "edge", "id": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65" },
    { "kind": "pin", "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio4" }
  ],
  "suggestions": [
    {
      "title": "Move I2C to GPIO8/GPIO9",
      "patch": {
        "op": "setEdgeBindings",
        "edge": "edge_dcb5a3c6-b232-4dbe-8f73-bd7f84aa9b65",
        "value": {
          "sda": { "from": { "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio8" } },
          "scl": { "from": { "node": "node_2a4dbf1f-1f50-42b1-8f67-b92a7c5d0f12", "pin": "gpio9" } }
        }
      }
    }
  ]
}
```

### 5. Build Minimal UI

Add a vertical-slice screen in `apps/web`.

The UI should show:

- a full-width React Flow graph editor
- source project summary in panels below the graph
- resolved bindings
- generated components
- diagnostics in a separate panel
- source JSON view
- resolved JSON view

Normal graph and inspector panels should render user-facing labels such as `Main MCU`, `Temperature sensor`, and `Sensor I2C bus`, not internal `node_...` or `edge_...` IDs. The raw JSON view may expose IDs because it is the canonical source/debug representation.

Controls:

- add RP2350
- add 3V3 rail
- add I2C sensor
- draw an edge from RP2350 to the sensor
- delete selected nodes and edges
- clear canvas
- reset sample
- toggle GPIO4 reservation

This is still a small graph editor. It only needs enough behavior to prove that authored graph changes feed the resolver and update the lockfile-style output.

### 6. Add Tests

Core tests:

- valid I2C source resolves successfully
- resolver selects `gpio4/gpio5` by default
- generated pullups are emitted
- generated pullups have stable IDs and structured source maps
- conflict on `gpio4` moves assignment to `gpio8/gpio9`
- invalid node reference produces diagnostic
- invalid port reference produces diagnostic
- invalid contract-port pair produces diagnostic

UI smoke tests:

- app starts with a blank editor canvas
- adding RP2350 and sensor nodes updates source JSON
- drawing an edge from RP2350 to the sensor creates an `intent.connection`
- adding a 3V3 rail enables generated pullups
- reset sample loads the prewired graph
- toggling conflict changes the resolved assignment or diagnostics

## Acceptance Criteria

- The app starts blank and lets the user create an RP2350-to-I2C-temperature-sensor intent graph.
- Resolving produces stable bindings for `sda` and `scl`.
- Generated pullups are visible in the UI and resolved output.
- Generated objects, nets, source maps, and patches use stable IDs.
- Conflict mode produces a meaningful result.
- Resolver logic lives outside React.
- The implementation follows the intent graph spec.
- The slice is small enough to replace later without preserving early shortcuts.

## Non-Goals

- No KiCad export.
- No PCB layout.
- No real component library.
- No package manager.
- No multiplayer or persistence.
- No AI editing loop yet.
- No production-grade graph editor.
- No reference designator assignment.
