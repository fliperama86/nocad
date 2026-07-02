# Draft Spec: PCB Layout Approach

Status: draft

This document defines how PCB layout fits the intent graph architecture described in `intent-graph-spec.md`. It extends the source/lockfile philosophy to board design instead of bolting a traditional board editor onto the side of the intent graph.

The core framing: **layout is manual satisfaction of generated obligations.** The resolver already emits the obligations: nets with differential-pair, impedance, and length-match constraints, placement hints such as `near_provider`, keepouts, and decoupling rules. Board geometry is how those obligations get discharged. Manual routing, assisted routing, and AI-proposed routing are three producers of the same artifact: authored geometry that references intent.

## Goals

- Keep one design graph with multiple projections. The board is a projection plus authored geometry, not a second source of truth.
- Make layout constraints flow automatically from intent. Nobody hand-maintains netclasses; the TMDS pair gets its impedance and length-match rules because the contract said so.
- Keep every geometry object traceable back to the intent that justifies it.
- Make layout diffs reviewable, and layout changes proposable as patches (by users, by the resolver, and by AI).
- Keep geometry, hit testing, and DRC in the portable EDA core so a future Rust/WASM port stays possible.
- Provide a KiCad export escape hatch early so users can finish boards in KiCad while nocad's editor matures.

## Non-Goals

- Do not build a push-and-shove router early. That is a multi-year effort and not where nocad differentiates.
- Do not attempt full autorouting or auto-placement as the primary workflow. Autorouting comes last, possibly never.
- Do not let the board file become an independently authored world with its own truth. The first time "just store this in the board file because it's easier" wins an argument, the architecture quietly becomes KiCad with extra steps.
- Do not render board objects as React components. The board surface is the custom canvas/WebGL engine; React is chrome only.

## Document Model

The two-way source/lock split becomes three-way:

```txt
project.nocad.json         authored intent          (exists)
project.nocad.lock.json    resolved obligations     (exists)
project.nocad.board.json   authored geometry        (new)
```

`project.nocad.board.json` contains placements with exact coordinates, tracks, vias, pours, stackup, board outline, and keepouts. It is authored source, not generated output: humans (and AI patches) write it, the resolver never regenerates it wholesale.

Every geometry object references intent through stable IDs:

```json
{
  "id": "trk_01j9...",
  "kind": "track",
  "net": "net_mcu_provides_hdmi_tmds2_p",
  "layer": "top",
  "width": 200000,
  "points": [[12000000, 8000000], [14500000, 8000000]]
}
```

A checker validates authored geometry against the lockfile's obligations continuously. DRC is the typechecker of the layout layer. This keeps the whole product inside one mental model: compiler, diagnostics, reviewable patches.

### Units

Coordinates are integer nanometers, following KiCad's internal convention. No floating-point coordinate accumulation in the document model.

## The Stable Derived ID Invariant

This invariant is load-bearing and must hold before any board file exists:

**Generated IDs in the lockfile must be stable, deterministic functions of source IDs.**

`net_<edgeId>_<signal>` already has this property; it must be a stated guarantee, not an accident. Tracks reference nets across re-resolutions. If the resolver ever renames a net because unrelated intent changed, every board file in the wild breaks.

Rules:

- A generated object's ID may change only if the source object it derives from changes identity.
- Re-running the resolver on unchanged intent must produce identical generated IDs.
- New resolver versions must preserve existing ID derivation schemes or provide an explicit migration.

## Change Management (ECO)

When intent changes remove or alter a net, its geometry becomes **orphaned with a diagnostic, never silently deleted**. The resolver proposes migration patches to the board source, and the user reviews them, mirroring the pin-assignment back-annotation flow in the intent graph spec:

```txt
intent change
  -> re-resolution
  -> lockfile diff
  -> board checker finds orphaned/mismatched geometry
  -> resolver emits board patch suggestions
  -> user reviews and applies
  -> project.nocad.board.json changes
```

This is the engineering change order workflow. The source/lock model handles it more cleanly than traditional forward/back annotation because every geometry object knows which intent justified it.

## Where nocad Differentiates

nocad will not beat established tools' interactive routers and should not try. The wins available to this architecture specifically:

1. **Constraints flow from intent.** Contract and feature elaboration produce net constraints automatically. An obligations panel shows satisfied/violated per constraint with click-to-locate. Quiet, dense, inspector-driven.
2. **Layout-aware pin assignment.** Already specified in the intent graph spec. For MCU-centric boards, a good pin assignment eliminates most crossings before a single track exists. A crude ratsnest-crossing cost model captures most of the value and requires no router.
3. **AI operates on structured layout.** "This diff pair has a stub," "these decoupling caps are far from their pins," proposed placement patches. All of it falls out of geometry-with-provenance; none of it needs screenshots.
4. **Reviewable layout diffs.** Geometry keyed by stable IDs, stored as independent objects rather than index-addressed arrays. This is also what the future sync layer (CRDT-friendly, local-first) wants, so the board document should be designed that way from day one.

## Obligations Panel

The primary layout UI surface after the canvas. It lists every obligation the lockfile places on the board and its current state:

- unplaced component (placement hint pending)
- unrouted net
- routed but constraint-violating (impedance, length match, clearance, pair symmetry)
- satisfied

"Unrouted" is just another unsatisfied state, so the panel is useful before routing tools exist at all.

## Engine And Core Layering

The board viewer is the forcing function for the real editor engine. Layering must be respected from the first line:

- **Rendering**: WebGL/WebGPU with instanced primitives. Lives in the web app / editor engine layer.
- **Geometry kernel**: polygon booleans (pours), clearance/distance checks, spatial index (R-tree), hit testing. Lives in the portable EDA core. No React, no Electron imports.
- **Data layout**: WASM-friendly from the start; flat typed arrays for hot geometry paths, not object graphs.

Define the geometry kernel interface in TypeScript now, implement it naively, and port hot paths to Rust/WASM when profiling says so, not before.

## KiCad Interop

Export `.kicad_pcb` early, before nocad's own routing matures. Users can place in nocad and finish in KiCad. This is the adoption trust-builder, and it forces the board model to remain KiCad-expressible. Export before import; import is much harder and can wait.

## Sequencing

Milestone ordering, acceptance criteria, and current status live in `docs/roadmap.md`. The dependency logic:

1. Data-driven resolver comes first; it is upstream of everything (obligations must come from package data, not resolver code).
2. Document model with patches and undo/redo comes before any editor surface that mutates state.
3. Read-only projections (schematic, then board placements + ratsnest) prove the engine before editing exists.
4. Placement editing before routing; placement plus pin-assignment scoring delivers most of the early value.
5. Obligations panel before routing tools; manual routing MVP (45-degree segments, vias, live clearance DRC, no shove) after.
6. KiCad export once placement exists; declarative pours and assisted routing (diff-pair assist, pattern replication) after the data model proves out.

## Open Questions

- Should `project.nocad.board.json` be one file per board from the start, given the vision's multi-board workspaces?
- How much of the stackup belongs in authored board source versus fabrication profiles?
- What is the minimum geometry kernel API that supports placement editing plus clearance DRC without painting the WASM port into a corner?
- How do pours reference keepouts derived from intent (e.g., antenna keepout from an RF function node) versus manually drawn ones?
- Where does versioned board history live once the sync layer exists: per-object CRDT history, git-style snapshots, or both?
