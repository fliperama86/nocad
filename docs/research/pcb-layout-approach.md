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

## Product Targets

nocad has two related targets with different scopes.

### EDA Capability MVP

The smaller RP2350 plus IT66121 sample remains the first end-to-end capability proof. It is deliberately bounded enough to validate authored board geometry, manual routing, obligations, DRC, document patches, persistence, and KiCad export without waiting for every real-board package and constraint.

This EDA capability MVP is not a replacement for the **Initial Product Slice** in `product-vision.md`. That product-wide slice establishes the workspace, schematic, structured graph, package/module, stable-ID, and AI-edit foundations before PCB layout becomes the focus. The target here is a narrower integration proof for the board stack once those foundations are available; it does not silently reorder or redefine the product slice.

### Pico RetroDigital North Star

The current Pico RetroDigital main board is the product north star. Success means authoring its complete semantic graph, resolving stable board obligations, completing an editable layout, and exporting a KiCad design that is functionally and manufacturing-equivalent to a qualified reference snapshot.

Equivalence is measured by connectivity, component/package identity, connector mappings, board outline and stackup, fabrication-critical pad and drill geometry, power and signal rules, placement-critical relationships, complete routes and zones, and an explainable DRC and manufacturing-artifact comparison. It does not require copying the original trace geometry, track ordering, or exact component coordinates. Manual layout can satisfy the north star. Automatic placement, global autorouting, and optimal routing are not acceptance requirements.

The required manufacturing boundary is a fabrication-capable KiCad export that preserves the authored board data and can feed auditable comparison artifacts. nocad-native BOM, CPL, Gerber, and drill-file generation is outside this north-star acceptance boundary for now; those artifacts may be generated from the exported KiCad project by the recorded external toolchain.

The north star therefore connects two product tracks:

- **Semantic graph track:** represent every subsystem, interface, power domain, provider chain, constraint, and generated obligation without raw resolver special cases.
- **PCB editor track:** project those obligations into authored placement, routes, vias, zones, checks, and a fabrication-capable KiCad export.

Neither track should be completed against toy data in isolation. They meet through progressive Pico RetroDigital subsystem slices and explicit integration gates, described in `pico-retrodigital-fixture-plan.md`.

## Routing Complexity And Product Strategy

"PCB routing" is not one algorithmic problem. Its complexity depends on what is fixed, what may change, which constraints apply, and whether the goal is any legal solution or a globally optimal one.

- Collision and clearance checks for fixed geometry are tractable validation problems.
- A single two-pin net with fixed obstacles and an additive cost can be modeled as a shortest-path problem and solved with algorithms such as Dijkstra or A*.
- Multi-pin optimal trees, vertex-disjoint paths, channel and switchbox variants, multi-net ordering, and joint placement plus routing contain NP-hard or NP-complete formulations.
- Some restricted routing formulations are polynomial-time solvable. NP-hardness of the general problem does not imply that every useful board instance or local operation is difficult.

Useful background:

- [VLSI Routing in Polynomial Time](https://doi.org/10.1016/S1571-0653(05)80184-2) surveys both polynomially solvable restrictions and NP-complete routing variants.
- [Efficient Detailed Routing on Optimized Tracks](https://hdl.handle.net/20.500.11811/9533) describes the theoretical hardness of detailed routing and the decomposition used for industrial-scale instances.

nocad therefore does not define success as finding the globally optimal whole-board route. The product strategy is progressive automation over one authoritative geometry and validation path:

```txt
structured board model + connectivity + DRC
  -> manual routing primitives
  -> deterministic user-directed assists
  -> bounded selected-net search
  -> selected groups and local rip-up/retry, if justified
  -> global coordination research, only if earlier evidence supports it
```

Each level may reuse lower-level operations. Each automated result is a proposed board patch. The router may fail cleanly, return alternatives, or identify placement and constraint conflicts. It may never silently relax rules, move components, modify locked geometry, or claim that completion alone establishes electrical quality.

### Selected-Net Problem Contract

The first search-based routing problem is intentionally narrow:

```txt
input:
  fixed component placement
  one selected net and its terminals
  existing pads, copper, vias, zones, and keepouts
  allowed layers
  width, clearance, and via rules
  optional user corridor or waypoints

output:
  one proposed legal route with metrics
  or an explicit failure with diagnostics
```

The proposal must include enough replay data to reproduce and inspect it: algorithm version, parameters, iteration budget and count, elapsed time, decomposed cost, and any random seed. Exact DRC is authoritative even when the search uses a coarse grid, learned heuristic, or approximate congestion model.

The first acceptance case is a simple management or control net removed from the curated HDMI breakout fixture. Differential pairs and multi-net coordination follow only after this contract is proven. See `pico-retrodigital-fixture-plan.md` and roadmap M10.

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

### Rendering Stack Decision

Decision: a custom, thin WebGL2 renderer for the 2D document surface. No scene-graph library. Rationale:

- The hard rendering work is EDA-specific either way: stroked segments with round caps/joins, arcs, rounded pads, polygons with holes, SDF text. General-purpose libraries do none of this well (three.js `gl.LINES` is 1px; `Line2` is a screen-space hack without caps), so custom tessellation and shaders are required regardless. Once those exist, a scene-graph library is a heavy context manager.
- Integer-nanometer coordinates overflow float32 vertex attributes (a 100mm board is 1e8 nm; float32 mantissa ends near 1.6e7). Any renderer needs chunk-local origins and CPU-side double-precision transforms; a custom pipeline makes that explicit instead of fighting library conventions.
- Hit testing, picking, and spatial queries live in the geometry kernel (above), so library raycasting and per-object scene graphs go unused by design. The kernel hands the renderer flat typed arrays; the renderer uploads buffers and draws layers in order.
- Flat typed arrays port cleanly to the Rust/WASM kernel. Retained per-object scene graphs do not.

Considered and rejected for this surface:

- **three.js**: viable in principle (Flux.ai shipped on it), but for 2D EDA most of it is dead weight and its line rendering is the weakest part. Revisit as the backend for a future 3D board preview, where it genuinely fits.
- **PixiJS**: fastest path to first pixels for the read-only board projection, but its retained `Graphics` model retessellates on change and imposes per-object structure; likely outgrown by manual routing.

Small leaf libraries that do not shape the document model are fine: `earcut` for triangulation (portable to the kernel later), an SDF font atlas for text, optionally `regl`/`twgl` to trim WebGL boilerplate. Keep a thin `Renderer` interface between engine and GL so a three.js-backed 3D viewer can be added later without touching the kernel.

## KiCad Interop

Export `.kicad_pcb` early, before nocad's own routing matures. Users can place in nocad and finish in KiCad. This is the adoption trust-builder, and it forces the board model to remain KiCad-expressible. Export before import; import is much harder and can wait.

## Sequencing

Milestone ordering, acceptance criteria, and current status live in `docs/roadmap.md`. The dependency logic starts with a shared foundation, then advances the semantic graph and PCB editor as interacting tracks:

1. Data-driven resolver comes first; it is upstream of everything (obligations must come from package data, not resolver code).
2. Document model with patches and undo/redo comes before any editor surface that mutates state.
3. After that shared foundation, expand a real Pico RetroDigital subsystem in the semantic graph and carry its resolved obligations into the editor before modeling the next subsystem where practical.
4. Read-only projections (schematic, then board placements + ratsnest) prove the engine before editing exists and expose missing semantic metadata early.
5. Placement editing precedes routing; placement plus pin-assignment scoring delivers most of the early value and feeds layout constraints back into the graph model.
6. The obligations panel precedes routing tools; manual routing MVP (45-degree segments, vias, live clearance DRC, no shove) follows.
7. KiCad export begins once placement exists. Declarative pours are required for north-star manufacturing equivalence, while deterministic assists (diff-pair assist, pattern replication, corridor completion) remain optional productivity tools.
8. Bounded selected-net search follows manual routing and deterministic assists. Global multi-net routing is not scheduled and is not required for either target unless selected-net evidence later justifies it.

Each subsystem should pass progressively stronger gates: semantic connectivity, board-model projection, authored layout obligations, and export/DRC comparison. This alternating path prevents the editor from being designed only around toy obligations and prevents the graph from accumulating constraints that have never been exercised by layout.

## EDA Capability MVP Cutline

EDA capability MVP definition: **place and route the RP2350 + IT66121 sample board in nocad, see every obligation's status, and export `.kicad_pcb` to finish in KiCad.** That is roadmap M1-M8. Explicitly out of the EDA capability MVP: pours, push-and-shove, autorouting, length tuning, KiCad import, and 3D preview (M9 and later).

This cutline is not the product north star. Recreating the Pico RetroDigital main board additionally requires the zones and broader rule coverage needed for manufacturing equivalence, but still does not require push-and-shove or automatic/global routing.

Feature inventory by layer:

Resolver prerequisites (intent-core):

- Stable-ID guarantee test-enforced: identical lockfile IDs on re-resolution and under source edge reordering (overlaps M1).
- Constraint metadata on contracts/signals: diff-pair grouping, impedance class, clearance class, length-match groups, emitted into the lockfile as obligations. `ContractSignal` currently carries only `direction`.
- Package geometry data: footprints (pad shapes/layers, courtyard, silk) for the sample components and generated passives.
- Placement hints (`near_provider`, decoupling-near-pin) generated from topology rules, not hardcoded paths.

Geometry kernel (new portable core package):

- Primitives and transforms on integer nm; bboxes; segment/arc/polygon math.
- Tessellation to flat vertex buffers: stroke expansion, arc discretization, triangulation.
- Spatial index (R-tree) plus exact hit testing with pick radius and layer priority.
- Connectivity: net islands via union-find over pads/tracks/vias (drives ratsnest and "unrouted").
- Clearance and courtyard-overlap checks (DRC v0); orphaned-geometry detection against the lockfile.
- Ratsnest computation (nearest unconnected island per net).

Board document (core):

- `project.nocad.board.json` schema: placements, tracks, vias, outline, keepouts, stackup; every object individually keyed and referencing lockfile IDs.
- All board edits through the document API (M2) as inspectable patches with undo/redo; save/load round-trip.

Editor engine (web app):

- Viewport: cursor-anchored pan/zoom across the full zoom range, DPR handling, grid, chunk-local origins for precision.
- Layered batched rendering: copper, silk, courtyards, outline, ratsnest, selection/hover overlays, drag ghosts; theme-aware colors.
- SDF text (refdes; net names on hover).
- Interaction FSM: click and box select, move with grid snap, rotate, keyboard-driven commands.

Chrome (React):

- Board tab, layer visibility panel, inspector for the selected object, obligations panel (M6) with click-to-locate.

Routing MVP (M7):

- 45-degree segment drawing, via insertion with layer switch, snap to pads and track ends, live clearance feedback. No shove.

Export (M8):

- `.kicad_pcb` writer with net mapping that survives KiCad's own DRC. Export before import.

## Open Questions

- Should `project.nocad.board.json` be one file per board from the start, given the vision's multi-board workspaces?
- How much of the stackup belongs in authored board source versus fabrication profiles?
- What is the minimum geometry kernel API that supports placement editing plus clearance DRC without painting the WASM port into a corner?
- How do pours reference keepouts derived from intent (e.g., antenna keepout from an RF function node) versus manually drawn ones?
- Where does versioned board history live once the sync layer exists: per-object CRDT history, git-style snapshots, or both?
