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

- show the source graph
- show a simple visual graph
- show resolved bindings
- show generated pullups
- show diagnostics
- allow toggling a simple conflict scenario

## Example Source

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
      "id": "rail_3v3",
      "kind": "powerDomain",
      "voltage": "3.3V"
    },
    {
      "id": "mcu",
      "kind": "component",
      "component": "@nocad/rp2350:RP2350A",
      "package": "QFN80"
    },
    {
      "id": "temp_sensor",
      "kind": "component",
      "component": "@nocad/sensors:I2C_TEMP_SENSOR"
    }
  ],
  "edges": [
    {
      "id": "sensor_bus",
      "kind": "intent.connection",
      "from": {
        "node": "mcu",
        "port": "i2c"
      },
      "to": {
        "node": "temp_sensor",
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
  ],
  "ui": {
    "graph": {
      "nodes": {
        "mcu": { "x": 120, "y": 160 },
        "temp_sensor": { "x": 460, "y": 160 },
        "sensor_bus": { "x": 290, "y": 160 }
      }
    }
  }
}
```

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
        "edge": "sensor_bus",
        "feature": "pullups"
      }
    }
  },
  "resolvedChoices": [
    {
      "id": "sensor_bus.pinAssignment",
      "sourceEdge": "sensor_bus",
      "strategy": "auto",
      "selected": {
        "bindings": {
          "sda": {
            "from": { "node": "mcu", "pin": "gpio4" },
            "to": { "node": "temp_sensor", "pin": "sda" }
          },
          "scl": {
            "from": { "node": "mcu", "pin": "gpio5" },
            "to": { "node": "temp_sensor", "pin": "scl" }
          }
        }
      },
      "reason": "Selected first available I2C-capable RP2350 pin pair."
    }
  ],
  "nets": [
    {
      "id": "net_i2c_sda",
      "name": "I2C_SDA",
      "endpoints": {
        "from": { "node": "mcu", "pin": "gpio4" },
        "to": { "node": "temp_sensor", "pin": "sda" }
      },
      "direction": "bidirectional",
      "sourceEdge": "sensor_bus",
      "sourceMap": {
        "edge": "sensor_bus",
        "signal": "sda"
      }
    },
    {
      "id": "net_i2c_scl",
      "name": "I2C_SCL",
      "endpoints": {
        "from": { "node": "mcu", "pin": "gpio5" },
        "to": { "node": "temp_sensor", "pin": "scl" }
      },
      "direction": "bidirectional",
      "sourceEdge": "sensor_bus",
      "sourceMap": {
        "edge": "sensor_bus",
        "signal": "scl"
      }
    }
  ],
  "generated": [
    {
      "id": "pullup_sda",
      "kind": "component",
      "component": "@nocad/passives:RESISTOR",
      "value": "4.7k",
      "connects": ["I2C_SDA", "rail_3v3"],
      "sourceEdge": "sensor_bus",
      "sourceMap": {
        "edge": "sensor_bus",
        "feature": "pullups"
      }
    },
    {
      "id": "pullup_scl",
      "kind": "component",
      "component": "@nocad/passives:RESISTOR",
      "value": "4.7k",
      "connects": ["I2C_SCL", "rail_3v3"],
      "sourceEdge": "sensor_bus",
      "sourceMap": {
        "edge": "sensor_bus",
        "feature": "pullups"
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

Add a sample source variant where `mcu.gpio4` is already reserved.

Concrete source variant:

```json
{
  "edges": [
    {
      "id": "debug_gpio",
      "kind": "net.binding",
      "bindings": {
        "debug": {
          "from": { "node": "mcu", "pin": "gpio4" }
        }
      }
    },
    {
      "id": "sensor_bus",
      "kind": "intent.connection",
      "from": {
        "node": "mcu",
        "port": "i2c"
      },
      "to": {
        "node": "temp_sensor",
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

- resolver should not assign `sensor_bus.sda` to `gpio4`
- resolver should choose `gpio8/gpio9` if available
- if no fallback pair exists, resolver should emit a diagnostic with a stable semantic patch suggestion

Example diagnostic:

```json
{
  "severity": "error",
  "code": "PIN_CONFLICT",
  "message": "mcu.gpio4 is already reserved.",
  "targets": [
    { "kind": "edge", "id": "sensor_bus" },
    { "kind": "pin", "node": "mcu", "pin": "gpio4" }
  ],
  "suggestions": [
    {
      "title": "Move I2C to GPIO8/GPIO9",
      "patch": {
        "op": "setEdgeBindings",
        "edge": "sensor_bus",
        "value": {
          "sda": { "from": { "node": "mcu", "pin": "gpio8" } },
          "scl": { "from": { "node": "mcu", "pin": "gpio9" } }
        }
      }
    }
  ]
}
```

### 5. Build Minimal UI

Add a vertical-slice screen in `apps/web`.

The UI should show:

- source project summary
- simple node/edge graph
- selected edge inspector
- resolved bindings
- generated components
- diagnostics
- source JSON view
- resolved JSON view

Controls:

- `Resolve`
- `Toggle conflict`
- `Apply suggestion`, if a diagnostic includes one

This does not need a full graph editor. Static nodes with clickable inspector panels are enough.

### 6. Add Tests

Core tests:

- valid I2C source resolves successfully
- resolver selects `gpio4/gpio5` by default
- generated pullups are emitted
- conflict on `gpio4` moves assignment to `gpio8/gpio9`
- invalid node reference produces diagnostic
- invalid port reference produces diagnostic
- invalid contract-port pair produces diagnostic

UI smoke tests:

- app renders the slice screen
- clicking resolve shows bindings
- toggling conflict changes the resolved assignment or diagnostics

## Acceptance Criteria

- The app shows an RP2350 connected to an I2C temperature sensor as source intent.
- Resolving produces stable bindings for `sda` and `scl`.
- Generated pullups are visible in the UI and resolved output.
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
- No full graph editor.
