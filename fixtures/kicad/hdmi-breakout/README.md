# HDMI Breakout KiCad Fixture

This is an immutable, minimal snapshot of the user-provided HDMI breakout design from `~/Projects/pico-retrodigital/hardware/hdmi_breakout/hdmi_breakout`.

Purpose:

- schematic and board projection acceptance;
- connectivity, geometry, and KiCad export research;
- manual routing validation; and
- the first bounded selected-net routing experiment, using `SCL` as the initial candidate.

The source directory was not tracked by its parent Git repository when captured. `manifest.json` therefore records the parent repository HEAD for context and pins the actual fixture with per-file SHA-256 digests. The fixture's license, fabricated status, and hardware-tested status remain explicitly unresolved. Do not describe it as redistributable or hardware-validated until those fields are resolved.

Run the integrity and structural checks from the nocad repository root:

```bash
pnpm verify:fixtures
```

Tests and conversion tools must never rewrite these files in place. Write derived or exported files to a temporary directory.

The browser research preview currently reads the board outline, footprints, pad and drill geometry, routed segments, serialized filled copper polygons, and footprint line, rectangle, and circle graphics. Copper, front silkscreen, front fabrication, front courtyard, user drawing, and user comment layers can be toggled independently. This is still a bounded fixture renderer, not a complete KiCad importer.
