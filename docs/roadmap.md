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
- `docs/i2c-vertical-slice-plan.md` - the original vertical slice plan (largely delivered).

## Current State (2026-07-02)

What exists and works:

- `packages/intent-core`: in-memory project source model (`nocad.project.v0` shaped), resolver, component/contract fixtures, sample projects, tests.
  - I2C connections: port/contract matching, auto and manual pin assignment, preferred pin pairs, generated pullups, conflict and reference diagnostics.
  - HDMI output function: feature-driven signal elaboration (TMDS, DDC, HPD, CEC), source 5V power, sideband resolution.
  - Provider modes and provider chains: function nodes stay implementation-agnostic; providers declare modes with signal maps; provider modes can declare cross-port requirements (`requires.ports`), proven with HDMI TX IC samples driven by either a generic FPGA or RP2350 over DPI + I2C upstream contracts. Resolved choices record selected provider modes.
  - Generic contract resolution (`intent.connection` works for any fixture contract, e.g. 28-signal DPI).
  - Regression coverage for provider-chain review issues: fixed-map override validation, authored-but-unresolved requirement cascade suppression, preferred-I2C fallback, and edge-order mitigation for the RP2350 TX-IC pressure case.
- `apps/web`: intent graph slice UI (`@xyflow/react` graph canvas, inspectors for nodes/edges, resolution/diagnostics/JSON panels, component palette, direct-HDMI, FPGA-via-TX-IC, and RP2350-via-TX-IC samples). React is chrome only; no editor engine exists yet.
- Shared config packages (eslint, tsconfig, vitest); pnpm + Turborepo workspace.

Known architectural debts (tracked in M1/M2 below):

- The resolver is still code-per-function: `resolveHdmiFunctions` is HDMI-shaped code, preferred-pair logic is I2C-shaped code. The spec calls for a generic interpreter over package data.
- Pin allocation is still greedy first-fit with constrained-first edge ordering. The RP2350 TX-IC edge-order failure is fixed and test-covered, but this is not yet the spec's full candidate-scoring model.
- UI mutates React state directly; there is no document API, no undo/redo, no persistence.
- Resolution is not incremental.

## In Progress (2026-07-02)

No active implementation thread. Next recommended work is M1, starting with generic topology-rule interpretation and package-data-driven HDMI function resolution.

## Milestones

Ordering rationale lives in `docs/research/pcb-layout-approach.md` (Sequencing section). Statuses: `todo`, `in progress`, `done` (with date).

### M1 - Data-driven resolver - todo

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

Start the custom canvas engine (per CLAUDE.md hard rules: no React per document object). First projection: generated schematic view from the lockfile (symbols, generated nets, source-map hover). Product priorities put schematics before PCB; both projections share this engine.

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

### M9 - Declarative pours + assisted routing - todo

Pours as intent ("GND pour on L2 with these keepouts", geometry generated). Diff-pair assist, pattern replication, corridor routing. Full autorouting stays last, possibly forever.

## Architecture Invariants

Short list; violating one is a design regression, not a style issue:

1. Function nodes are implementation-agnostic. "How" is provider topology (provides edges, modes, upstream contract edges). If a feature seems to need per-implementation function nodes, implementation detail is leaking.
2. Generated IDs are stable, deterministic functions of source IDs. Board geometry and external references depend on it.
3. Geometry is authored; obligations are generated. The resolver never regenerates the board file wholesale; it proposes patches.
4. EDA core stays portable: no React, no Electron imports; WASM-friendly data layouts on hot paths.
5. Editor documents are never rendered as one React component per object.
6. AI and tools edit through inspectable, undoable patches addressed by stable IDs; never silent mutation, never `R12`-style identity.

## Open Decisions

- Schematic projection policy: how much manual schematic layout override is stored (as view metadata), versus fully generated placement with heuristics. Decide during M3.
- Board file granularity: one board file per board from the start (multi-board vision) or single file until needed. Decide before M5.
- KiCad export timing: M8 can be pulled earlier (placement-only export) if adoption/testing demands it.
- Package distribution: how component packages (`@nocad/rp2350`, ...) are versioned and fetched once they leave fixtures.

## History

- 2026-07-02 - Provider-chain review fixes landed: constrained-first connection ordering, provider requirement cascade suppression, fixed-map override validation, preferred-I2C fallback, provider mode recording in lockfile-shaped output, UI provider modes derived from component metadata, and `optional` provider requirements.
- 2026-07-02 - Added first-class RP2350-to-HDMI-TX sample and UI loader. RP2350 drives the TX IC through upstream DPI and I2C contracts; the TX IC remains the HDMI function provider.
- 2026-07-01 - Provider chains landed (TX IC support, `requires.ports`, generic contract resolution); spec gained "Provider Chains" section; roadmap and PCB approach docs created.
- Prior - I2C vertical slice (resolver, diagnostics, pullups, slice UI); HDMI function slice (sidebands, source 5V, metadata-driven function UI).
