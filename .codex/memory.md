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
- Inline topology must be function/package data-driven. For a series interposer, replace the selected logical net with stable provider and connector segments around a generated component, keep authored endpoint bindings unchanged, and project the generated component so neither ratsnest segment disappears.
- Object-valued include fields use their declared defaults when the include object is absent. Off must preserve the original net and dependency state; invalid selectors and multiple active interposers must diagnose rather than silently no-op or implicitly chain.
- Before an inline rule creates authoritative net endpoints, validate that its generated component exists and that the provider/connector terminals both exist and are distinct. Invalid package data leaves the logical net unsplit.

## Project Documents

- Public document patches target stable node/edge IDs. Array indices belong only to generated inverse operations used to restore exact ordering.
- Keep `getSnapshot()` frozen and identity-stable until a real document change so external-store consumers are safe. Reject no-ops without history changes, make batches atomic, deep-clone exposed records/copies, and restore absent optional containers exactly during undo.
- Validate JSON-only data at source and patch ingress without reconstructing known fields, so unknown future keys survive save/load while undefined, non-finite and negative-zero numbers, BigInt, functions, symbols, cycles, sparse/noncanonical arrays, accessors, and hidden data are rejected.
