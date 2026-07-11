# Roadmap

Status: living document

This is the tracking document for nocad: where we are, what is in progress, and what comes next. It is the first thing to read when resuming work and the last thing to update when finishing it.

Maintenance rules:

- Update this file in the same change that completes or reorders a milestone. A milestone is not done until its entry here says so.
- Keep "Current State" honest and short; it describes what exists in the repo, verified, not what is planned.
- Detailed designs live in `docs/research/`; this file holds status, ordering, and acceptance criteria only.
- Date every status change (absolute dates, not "last week").

Reference documents:

- `docs/research/product-vision.md` - why nocad exists, product principles.
- `docs/research/intent-graph-spec.md` - source format, resolver model, lockfile, contracts, provider chains.
- `docs/research/pcb-layout-approach.md` - board layout architecture (obligations model, board source file, engine layering).
- `docs/research/autorouter-lessons.md` - external autorouting lessons, caveats, and implications for nocad.
- `docs/research/pico-retrodigital-fixture-plan.md` - trusted board fixtures and their intended milestone coverage.
- `docs/i2c-vertical-slice-plan.md` - the original vertical slice plan (largely delivered).

## Current State (2026-07-10)

What exists and works:

- `packages/intent-core`: in-memory project source model (`nocad.project.v0` shaped), resolver, component/contract fixtures, sample projects, tests.
  - I2C connections: port/contract matching, auto and manual pin assignment, contract-scoped preferred pin groups, data-driven shunt-to-power pullup generation, conflict and reference diagnostics.
  - HDMI output function: feature-driven signal elaboration (TMDS, DDC, HPD, CEC), source 5V power, sideband resolution.
  - Generic function topology interpretation: function definitions select their contract, active signal groups, and supplementary generated nets. HDMI and a data-only digital-output fixture both resolve through the same path; net-name prefixes are contract metadata.
  - Provider modes and provider chains: function nodes stay implementation-agnostic; providers declare modes with signal maps; provider modes can declare cross-port requirements (`requires.ports`). The HDMI function can derive a `generic_gpio` provider from a component pin pool, allowing the generic FPGA to provide TMDS without an FPGA-specific HDMI port. The FPGA can alternatively drive an HDMI TX IC over pixel-stream + I2C upstream contracts; RP2350 direct and TX-IC paths are also covered. Resolved choices record selected provider modes.
  - Generic contract resolution (`intent.connection` works for any fixture contract). Pixel-stream bindings have authored params (`transport`, RGB bit widths, sync signals) that expand to the active signal set.
  - Regression coverage for provider-chain review issues: fixed-map override validation, authored-but-unresolved requirement cascade suppression, preferred-I2C fallback, and edge-order mitigation for the RP2350 TX-IC pressure case.
- `apps/web`: intent graph slice UI (`@xyflow/react` graph canvas, inspectors for nodes/edges, resolution/diagnostics/JSON panels, component palette, direct-HDMI, FPGA-via-TX-IC, and RP2350-via-TX-IC samples). Connection params are edited from contract metadata, with pixel-stream presets as UI sugar. Connection gestures are validated against package-declared port direction, contracts, function providers, and exposures before an edge is committed; invalid drops stay out of source and report the reason beside the canvas. React is chrome only; no editor engine exists yet.
- Board-placement prototype: Canvas2D board projection with footprint selection, drag/rotate placement, ratsnest updates, clickable obligations, and simple rectangular overlap diagnostics. It is exploratory and does not complete M4/M5: placement still mutates React source state directly, footprint envelopes and DRC are approximate, and geometry/hit testing have not moved into the portable editor core.
- Curated fixture infrastructure: `fixtures/kicad/hdmi-breakout/` contains a content-pinned minimal KiCad 10 snapshot with a manifest. `pnpm verify:fixtures` checks file hashes and recorded structural facts, and runs as part of `pnpm test`. The PCB tab can open a lazy-loaded, read-only preview parsed directly from the pinned board source, including its actual outline, pads, tracks, vias, filled zones, source drawing layers, footprints, and net isolation. A temporary local test also rendered the 50 mm x 38 mm Pico RetroDigital main PCB with 70 footprints, 611 tracks, 58 vias, and 20 filled polygons without retaining that board in the repository. This does not complete M4 or constitute a supported KiCad importer. License and hardware qualification remain unresolved, so the fixture is not yet marked golden.
- Shared config packages (eslint, tsconfig, vitest); pnpm + Turborepo workspace.

Known architectural debts (tracked in M1/M2 below):

- Function provider/exposure resolution, connection shunt generation, preferred pin groups, and pin-assignment suggestions are data-driven. Suggested binding patches are package-authored, contract- and port-scoped, validated against current reservations, and exercised by I2C and non-I2C round-trip tests. The Diagnostics UI does not apply these patches yet; document patch application belongs to M2.
- Connection allocation now uses deterministic candidate cardinality, constrained-first signal ordering, stable semantic tie-breaks, and pin-scarcity scoring. Reversing uniquely identified connection edges is regression-tested, including competing auto and explicit assignments. Allocation remains greedy rather than a global search, and function-provider pins are still allocated in a later sequential phase.
- UI mutates React state directly; there is no document API, no undo/redo, no persistence.
- Resolution is not incremental.

## In Progress (2026-07-11)

M1 is active. Function resolution, generated supplementary nets, contract shunts such as pullups, contract- and port-scoped preferred pin groups, and diagnostic pin suggestions now come from package data. Connection allocation has deterministic candidate scoring and improved edge-order invariance for unique edge IDs, while remaining a bounded greedy pass rather than Cartesian or global search. Next, decide whether function-provider allocation must join the same scoring pass, then close the remaining full-output edge-order cases before starting M2.

## Milestones

Ordering rationale lives in `docs/research/pcb-layout-approach.md` (Sequencing section). Statuses: `todo`, `in progress`, `done` (with date).

### M1 - Data-driven resolver - in progress

Replace function-specific resolver code with a generic interpreter over function definitions, feature elaboration, and topology rules. Replace greedy first-fit allocation with deterministic, order-independent candidate selection (constrained-first ordering or scoring).

Done when:

- Adding a second function type (e.g. `USB device port`) requires only package/fixture data, zero resolver changes.
- `resolveHdmiFunctions` / `resolvePreferredI2cPairBindings` special-casing is gone.
- Resolution output is identical regardless of source edge array order (test-enforced).
- Generated pullups/termination come from generic topology rules, not hardcoded paths.

### M2 - Document model, patches, undo/redo - todo

A real document API between UI/AI and the source graph: semantic patch operations (`setEdgeBindings`, `addNode`, ...), undo/redo, save/load of `project.nocad.json`.

Done when:

- The slice UI mutates only through the document API.
- Every edit is an inspectable patch; undo/redo works across all edit types.
- A project round-trips to disk and back losslessly.

### M3 - Editor engine foundation + schematic projection (read-only) - todo

Start the custom canvas engine (per CLAUDE.md hard rules: no React per document object). First projection: generated schematic view from the lockfile (symbols, generated nets, source-map hover). Product priorities put schematics before PCB; both projections share this engine. Rendering stack decision (custom thin WebGL2 renderer, no scene-graph library; three.js reserved for a possible later 3D preview) is recorded in `docs/research/pcb-layout-approach.md`.

Done when:

- Canvas engine renders the schematic projection of the HDMI TX sample with stable pan/zoom.
- Geometry/hit-testing primitives live in a portable core package (no React/Electron imports).
- Selection in the projection links back to intent graph objects.

### M4 - Board projection (read-only) - todo

Render placements (from layout intent + package footprints) and ratsnest from the lockfile. Makes layout-aware pin-assignment scoring visible and debuggable.

Done when:

- Board view shows footprints, placement hints, ratsnest for a sample project.
- Pin-assignment scoring inputs/outputs are inspectable from the board view.

### M5 - Placement editing + `project.nocad.board.json` - todo

Authored board source file lands (stable-ID invariant enforced first; see `pcb-layout-approach.md`). Dragging writes exact coordinates into board source; intent hints score placements; courtyard-overlap DRC runs live.

Done when:

- Board file exists, is authored via the document API, and survives re-resolution of unchanged intent byte-identically in its references.
- Orphaned-geometry diagnostics fire when intent changes remove referenced nets.

### M6 - Obligations panel - todo

Constraint states (unplaced / unrouted / violating / satisfied) listed with click-to-locate. Useful before routing tools exist.

### M7 - Manual routing MVP - todo

45-degree segments, vias, snap, live clearance DRC. No push-and-shove.

### M8 - KiCad export - todo

`.kicad_pcb` (and schematic) export as the escape hatch: place in nocad, finish in KiCad. Export before import.

### M9 - Declarative pours + deterministic routing assists - todo

Pours as intent ("GND pour on L2 with these keepouts", geometry generated). Add user-directed operations that do not require a global router: diff-pair drawing assistance, pattern replication, fanout helpers, and corridor-constrained completion. Every result is an ordinary inspectable board patch and must pass the same DRC as manual geometry.

### M10 - Selected-net routing experiment - todo

Route one explicitly selected net at a time with fixed placement, existing copper, keepouts, allowed layers, width, and clearance supplied as inputs. This is a bounded local search experiment, not a commitment to whole-board autorouting or global optimality. The first acceptance fixture is a curated snapshot of the HDMI breakout described in `docs/research/pico-retrodigital-fixture-plan.md`.

Done when:

- Removing one simple management or control trace from the HDMI breakout fixture produces a well-defined unrouted obligation.
- The router either proposes a DRC-clean route or reports failure without mutating the document.
- A proposed route is deterministic for the same input and records its algorithm version, parameters, iteration count, elapsed time, and cost breakdown.
- The route is applied only through an inspectable, undoable document patch.
- The UI can overlay the proposal, existing geometry, explored region, and relevant cost or failure information in board coordinates.
- Success is measured by legality, bounded interactive behavior, and reviewability. Matching the original human route or proving optimality is not required.

Global multi-net autorouting is deliberately not a committed milestone. Evidence from M10 must justify any later experiment in net ordering, congestion pricing, local rip-up-and-reroute, partitioning, or learned ranking. A useful system may route only a selected region or subset and identify the remaining placement or constraint conflicts.

## Architecture Invariants

Short list; violating one is a design regression, not a style issue:

1. Function nodes are implementation-agnostic. "How" is provider topology (provides edges, modes, upstream contract edges). If a feature seems to need per-implementation function nodes, implementation detail is leaking.
2. Generated IDs are stable, deterministic functions of source IDs. Board geometry and external references depend on it.
3. Geometry is authored; obligations are generated. The resolver never regenerates the board file wholesale; it proposes patches.
4. EDA core stays portable: no React, no Electron imports; WASM-friendly data layouts on hot paths.
5. Editor documents are never rendered as one React component per object.
6. AI and tools edit through inspectable, undoable patches addressed by stable IDs; never silent mutation, never `R12`-style identity.
7. Routing automation is progressive and fallible. Manual geometry, deterministic assists, and selected-net search share one patch and DRC path; no router bypasses validation or silently changes placement, constraints, or locked geometry.

## Open Decisions

- Schematic projection policy: how much manual schematic layout override is stored (as view metadata), versus fully generated placement with heuristics. Decide during M3.
- Board file granularity: one board file per board from the start (multi-board vision) or single file until needed. Decide before M5.
- KiCad export timing: M8 can be pulled earlier (placement-only export) if adoption/testing demands it.
- Package distribution: how component packages (`@nocad/rp2350`, ...) are versioned and fetched once they leave fixtures.

## History

- 2026-07-11 - Replaced source-order allocation ties and first-matching selectable pins with deterministic candidate scoring. Connections use effective candidate cardinality after authored reservations, explicit bindings take priority, constrained signals and stable IDs break ties, and generic selectors preserve pins with scarce extra capabilities. Reversed-edge regressions cover competing auto and explicit assignments. Allocation remains greedy, and function providers remain sequential.
- 2026-07-11 - Added capability-derived direct TMDS output for the generic FPGA. The graph matches the HDMI function's `generic_gpio` provider rule to the FPGA's 64-pin `io0` through `io63` pool, without adding an FPGA-specific HDMI port, and retains the FPGA-via-TX-IC path as a separate topology. The provider inspector derives this generic mode from package/function metadata and no longer leaks the RP2350 GPIO12-19 HSTX preset into FPGA mappings.
- 2026-07-10 - Fixed graph connection UX so incompatible node pairs are rejected before source mutation. Function provider/exposure ports are now selected from package data instead of role-name heuristics, invalid drops show an inline explanation, and browser checks cover rejecting an I2C sensor as an HDMI provider while preserving valid I2C and HDMI connections.
- 2026-07-10 - Continued M1 by moving I2C pullups into generic contract `shuntToPower` rules and replacing component-specific I2C pair fields with contract-scoped preferred pin groups. Added a non-I2C biased-signal fixture that uses the same interpreter, while preserving stable generated IDs and provenance.
- 2026-07-10 - Started M1. Replaced HDMI-specific function dispatch with a generic function topology interpreter, moved HDMI source 5V generation and net-name prefixes into fixture data, added a second data-only digital-output function, and verified provider/exposure edge-order invariance for function resolution.
- 2026-07-10 - Added an in-browser HDMI breakout fixture preview. It parses the pinned KiCad board source, renders actual outline, pad, track, via, filled-zone, and source drawing geometry, toggles layers, and isolates selected nets. A temporary local test successfully rendered the denser Pico RetroDigital main PCB; only generic rectangular-outline and via support was retained. Added parser regression coverage and kept the fixture payload in a lazy-loaded chunk.
- 2026-07-10 - Existing board-placement prototype verified with focused and full tests, typecheck, lint, and production build. Added a content-pinned HDMI breakout fixture plus integrity and structural verification. The fixture remains non-golden until license and hardware qualification are explicit.
- 2026-07-10 - Routing scope clarified: general routing contains NP-hard formulations, but nocad progresses through exact validation, manual routing, deterministic assists, and bounded selected-net search. Added M10 with the HDMI breakout as its first acceptance fixture; global multi-net autorouting remains uncommitted.
- 2026-07-04 - PCB layout plan fleshed out in `docs/research/pcb-layout-approach.md`: rendering stack decision (custom thin WebGL2 renderer; three.js/PixiJS evaluated and rejected for the 2D surface, three.js reserved for a later 3D preview) and an MVP cutline (M1-M8 feature inventory by layer; pours/shove/autorouting/import/3D deferred).
- 2026-07-02 - Provider-chain review fixes landed: constrained-first connection ordering, provider requirement cascade suppression, fixed-map override validation, preferred-I2C fallback, provider mode recording in lockfile-shaped output, UI provider modes derived from component metadata, and `optional` provider requirements.
- 2026-07-02 - Added parametric connection contracts for pixel streams. RP2350-to-HDMI-TX now expresses RGB565 as connection params on `@nocad/video:pixel_stream.v1`; RGB presets are UI conveniences, not provider modes.
- 2026-07-02 - Added first-class RP2350-to-HDMI-TX sample and UI loader. RP2350 drives the TX IC through upstream pixel-stream and I2C contracts; the TX IC remains the HDMI function provider.
- 2026-07-01 - Provider chains landed (TX IC support, `requires.ports`, generic contract resolution); spec gained "Provider Chains" section; roadmap and PCB approach docs created.
- Prior - I2C vertical slice (resolver, diagnostics, pullups, slice UI); HDMI function slice (sidebands, source 5V, metadata-driven function UI).
