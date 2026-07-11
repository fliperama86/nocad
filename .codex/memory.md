# Project Memory

## Visual Fidelity

- Do not describe the KiCad fixture preview as perfect or complete. Treat it as a narrow research renderer and state its supported primitives.
- Preserve KiCad's board-coordinate rotation convention when transforming footprint-local pad coordinates. Validate transformed pads against connected track endpoints, not only aggregate counts.
- In placed `.kicad_pcb` footprints, transform pad `at` x/y from footprint-local coordinates, but treat the pad `at` angle as the serialized board orientation. Do not add the footprint rotation again. Validate the long axis of signal and mounting pads against the source footprint and connected traces.
- Render the declared pad and drill shapes and dimensions. In particular, through-hole `oval` pads with `drill oval` must appear as pill-shaped copper with a pill-shaped hole, not as rectangles with circular holes.
- A board preview is not visually representative if it omits filled copper zones or source drawing layers. Render serialized `filled_polygon` geometry and expose footprint silk, fabrication, courtyard, drawing, and comment layers separately.

## Interaction Validation

- Do not let the graph UI appear to accept an electrically invalid connection and rely only on the Diagnostics tab to explain it later. Validate endpoint and contract compatibility before committing an edge, or make rejection immediate and visible at the interaction site.
- The generic FPGA should connect directly to HDMI intent through a generic GPIO pin pool and function-level capability matching, not through a bespoke FPGA HDMI port. The external HDMI transmitter path remains a separate topology.
- When changing repeated JSX controls, patch with component-specific context and inspect the exact occurrence. The provider mode grid may collapse to one column for a single generic mode, while the I2C auto/manual grid must remain two columns.
- Provider inspector editability and mode-switch binding retention must come from the selected ProviderModeDefinition signal map. A `pinSelector` mapping is user-editable and preserves authored provider bindings; a fixed `pin` mapping is read-only and discards conflicting authored provider bindings.
- Render active provider requirements as metadata-labeled, individually connectable target sockets on the component node. When those sockets exist, omit the anonymous target handle so users cannot bypass exact requirement selection.

## Roadmap Direction

- Treat the current Pico RetroDigital main board as the product north star, while keeping the smaller RP2350 plus IT66121 board as an EDA capability MVP.
- After shared resolver and document foundations, advance two cooperating tracks: full semantic-graph representation of the north-star design and the editor/PCB path through placement, manual routing, zones, and KiCad export. Validate them through subsystem slices and integration gates rather than completing either track only against toy data.

## Resolver Determinism

- Do not pre-reserve bindings from every `intent.provides` edge. Protect hard provider pins only for validated, unambiguous function topology with valid endpoints, modes, signal maps, and overrides. Include fixed mode pins, diagnose collisions between valid provider claims, and let orphan, invalid, or ambiguous provider edges claim nothing.
- Duplicate edge IDs must invalidate every occurrence rather than selecting a source-order survivor. Canonicalize hard reservation ownership, report conflicts, and test full `ResolvedProject` equality across all source edge-array permutations.
