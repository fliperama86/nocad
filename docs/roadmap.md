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
- `references/north-star/pico-retrodigital-main/README.md` - content pin, normalized north-star inventory, rights/qualification limits, and verification scope.
- `docs/i2c-vertical-slice-plan.md` - the original vertical slice plan (largely delivered).

## Current State (2026-07-12)

What exists and works:

- `packages/intent-core`: portable in-memory project source model (`nocad.project.v0` shaped), resolver, project document, board projection, and tests. Resolver, assignment, and board projection APIs receive a caller-owned definition catalog; engine entrypoints import no fixture or sample registry. Project source provenance and dependency content hashes are supplied or computed by the caller rather than fabricated by the resolver. Protocol-specific fixtures and samples are available only from the explicit test/demo subpath `@nocad/intent-core/fixtures`.
  - I2C connections: port/contract matching, auto and manual pin assignment, contract-scoped preferred pin groups, data-driven shunt-to-power pullup generation, conflict and reference diagnostics.
  - HDMI output function: feature-driven signal elaboration (TMDS, DDC, HPD, CEC), source 5V power, sideband resolution.
  - Generic function topology interpretation: function definitions select their contract, active signal groups, supplementary generated nets, and inline series-interposer rules. HDMI per-conductor termination and a data-only digital-output series-protection fixture both split selected nets through generated resistors using the same path; net-name prefixes, dependencies, values, terminals, and placement hints are contract/function metadata.
  - Provider modes and provider chains: function nodes stay implementation-agnostic; providers declare modes with signal maps; provider modes can declare cross-port requirements (`requires.ports`). Generic pin-pool behavior remains covered with test-local definitions, while shipped palettes and demos use only identified real components. RP235x direct output and RP235x plus IT66121 provider chains are covered. Resolved choices record selected provider modes.
  - Generic contract resolution (`intent.connection` works for any fixture contract). Pixel-stream bindings have authored params (`transport`, RGB bit widths, sync signals) that expand to the active signal set.
  - Regression coverage for provider-chain review issues: fixed-map override validation, authored-but-unresolved requirement cascade suppression, preferred-I2C fallback, validated provider pin claims, ambiguous topology rejection, and exact full-output edge-permutation invariance across mixed and malformed projects.
- `packages/component-library`: asynchronous, data-first loading for a closed production catalog. Built-in JSON definitions currently cover interface-level RP2350A, RP2354B, IT66121, and TE 1-1734839-4 models plus four contracts and one video-output function. Runtime loading verifies canonical definition SHA-256 values, unified package-closure hashes, descriptor shape and immutability, and catalog cross references before returning data. Descriptors expose manufacturer part number, definition coverage, physical package when verified, nocad package identity, content hashes, and provenance. Generic stand-ins and generated fake parts are not shipped in this library; current board envelopes are explicitly estimates.
- `apps/web`: protocol-agnostic project workspace UI under `features/workspace`. The production entry dynamically loads the real component library into a blank project and receives its catalog and resolver environment through composition. Protocol-specific examples live only under the isolated `/demo.html` development surface and use real component nodes. The KiCad research renderer lives only under `/fixture.html`. Graph connection planning, inspectors, preferred pin groups, provider modes and presets, contract controls, requirement sockets, generated schematic and board projections, resolution, diagnostics, and JSON views interpret catalog metadata without comparing protocol, signal, component, feature, or project IDs.
- `packages/editor-core`: portable, rendering-neutral geometry, viewport transforms, scene primitives, hit testing, and deterministic schematic projection. It has no React, Electron, DOM, protocol, component, or project dependency. The web workspace renders its scene through one custom WebGL2 canvas, with stable fit/pan/zoom, source-map hover, and node/edge selection shared with the graph.
- Board-placement prototype: Canvas2D board projection with footprint selection, drag/rotate placement, ratsnest updates, clickable obligations, and overlap diagnostics. Portable editor-core scenes now own rotated footprint geometry, hit testing, source maps, and rotation-aware overlap checks. Multi-endpoint nets project as deterministic minimum-spanning ratsnests with one shared net identity. Generated inline components appear as placement obligations, use their near-endpoint hint for an approximate anchor, and preserve split ratsnest segments. Placement is authored through the document API, but the prototype remains exploratory and does not complete M4/M5 because footprint envelopes remain approximate, pin-assignment scoring is not board-aware or inspectable, and there is no separate authored board document.
- Curated fixture infrastructure: `fixtures/kicad/hdmi-breakout/` contains a content-pinned minimal KiCad 10 snapshot with a manifest. `pnpm verify:fixtures` checks file hashes and recorded structural facts, and runs as part of `pnpm test`. The isolated `/fixture.html` development surface parses the pinned board source and renders its actual outline, pads, tracks, vias, filled zones, source drawing layers, footprints, and net isolation. A temporary local test also rendered the 50 mm x 38 mm Pico RetroDigital main PCB with 70 footprints, 611 tracks, 58 vias, and 20 filled polygons without retaining that board in the repository. This does not complete M4 or constitute a supported KiCad importer. License and hardware qualification remain unresolved, so the fixture is not yet marked golden.
- North-star reference inventory: `references/north-star/pico-retrodigital-main/` pins the dirty working-tree design inputs separately from stale evidence, without copying the license-unknown KiCad or production files. It normalizes 69 schematic components, 337 physical pin UUIDs, 60 virtual power symbols, 133 wires, 32 junctions, 158 labels, 20 explicit no-connects, 70 footprint instances, 379 pad UUIDs, and 123 nets in both schematic and PCB views. The source-free verifier checks object-to-net closure, independently derives PCB logical pin partitions, and proves exact represented-pin connectivity. Twenty-two non-electrical footprint pads are exact exclusions; the two unused J5 SBU pads have one fingerprinted waiver; duplicate C5 physical implementation remains separately visible. Subsystem ownership, boundaries, interfaces, power domains, support circuits, stackup, netclasses, differential pairs, rules, zones, nocad coverage, identity anomalies, and qualification unknowns remain captured and mutation-tested.
- Shared config packages (eslint, tsconfig, vitest); pnpm + Turborepo workspace.
- `ProjectDocument` core: JSON-validated, lossless `nocad.project.v0` save/load; stable-ID semantic patches for current graph/inspector edits; atomic batches; exact inverse patches; undo/redo; stale-revision guards; immutable stable snapshots and subscriptions. Core tests cover rejected/no-op edits, redo branching, exact array/container restoration, caller isolation, and unknown future-key preservation.

Known architectural debts (tracked in M1/M2 below):

- Function provider/exposure resolution, connection shunt generation, preferred pin groups, and pin-assignment suggestions are data-driven. Suggested binding patches are package-authored, contract- and port-scoped, validated against current reservations, and exercised by I2C and non-I2C round-trip tests. The Diagnostics UI applies them through the document API with the revision captured alongside the displayed resolution, so stale suggestions are rejected.
- Allocation uses deterministic candidate cardinality, constrained-first signal and edge ordering, stable semantic tie-breaks, and pin-scarcity scoring. Valid explicit and fixed provider claims are protected before connection allocation, then function providers run in a deterministic constrained-first phase after their upstream connection requirements resolve. This bounded two-phase allocator is deliberately not a global search, so a legal assignment can still require user guidance even though results no longer depend on source edge-array order.
- Generated dependency provenance currently records one canonical introducer. This is deterministic but lossy when multiple topology edges introduce the same package; plural provenance remains document-schema debt.
- Inline topology currently supports one series interposer per selected signal group. Multiple matching rules are diagnosed rather than implicitly chained; general interposer chains and additional selector/operation kinds remain future schema work.
- Resolution is not incremental.

## Next Delivery (2026-07-12)

G1 and M3 are complete after the shared M1-M2 foundation. Schematic work is intentionally frozen at a generated read-only debugging view; graph authoring and PCB capability are the product priorities. G2 and M4 are in progress. The graph now has deterministic authored multi-endpoint physical nets that reserve real pins; explicit realization links coalesce compatible semantic intent into that same physical identity and diagnose incompatible ownership. Edge-owned generated-component realizations can substitute a captured authored component, including explicit terminal remapping, before segment nets reconcile. Schematic and board projections consume the single reconciled identities. The PCB path now consumes portable, rotation-aware scene geometry and deterministic minimum-spanning ratsnests. The pinned north-star logical-interface fixture still does not claim physical parity because the remaining auxiliary power/bias circuitry, connector physical-pin mapping, and component identities are not fully qualified.

The Pico RetroDigital main board is the product north star. Work after the shared foundation advances in two cooperating tracks rather than completing one in isolation: the semantic graph grows subsystem by subsystem toward full design representation, while the editor/PCB track consumes those increasingly realistic resolved outputs. The integration gates below decide when a capability works end to end.

## North Star and Delivery Model

The product north star is:

> Recreate the Pico RetroDigital main board natively in nocad and export an electrically equivalent, DRC-reviewable KiCad design.

"Recreate" means functional and manufacturing equivalence against a content-pinned reference, not identical placement or trace geometry. The current capture records 70 footprints, 123 PCB nets, 379 pads, 611 track segments, 58 vias, and 5 zones. It is content-pinned and provenance-recorded, but remains explicitly non-golden because licensing, current DRC/ERC, fabrication, hardware testing, external library revision, and full schematic-connectivity normalization are unresolved.

The smaller RP2350 + IT66121 project remains the **EDA capability MVP**. It is the first compact design that must pass through graph authoring, resolution, placement, routing, and export. It reduces iteration cost; it does not replace the north star or the broader Initial Product Slice in `docs/research/product-vision.md`.

The Initial Product Slice remains the product-level target around that EDA proof: workspace and multi-project UX, schematic basics, package/module manifests, install/configuration/override flows, stable identities, AI-readable context, and validated AI-proposed edits. The roadmap tracks those concerns primarily in M2, G2, and M3 rather than treating one sample board as the whole product.

Delivery has three parts:

1. **Shared foundation (M1-M2):** deterministic resolution and a persistent, patch-based document model used by both tracks.
2. **Intent / Semantic Graph track (G1-G3):** represent the complete north-star design as packages, functions, connections, constraints, and diagnostics.
3. **Editor / PCB track (M3-M9):** project resolved obligations into shared schematic/board editor infrastructure and an authored board, then place, route, pour, inspect, and export it.

The tracks should advance in integrated vertical slices. A real subsystem is modeled in the graph, projected into the editor, and used to expose missing semantics or editor assumptions before the next subsystem is added. The current suggested subsystem order is video/HDMI, MCU and clocks, level shifting and FFC interfaces, USB and power, audio/control, then remaining support circuitry. G1 must qualify the exact parts and boundaries before this ordering becomes a reference claim.

Statuses: `todo`, `in progress`, `done` (with date). Detailed architecture and sequencing rationale remain in `docs/research/pcb-layout-approach.md`.

## Shared Foundation

### M1 - Data-driven resolver - done (2026-07-11)

Replace function-specific resolver code with a generic interpreter over function definitions, feature elaboration, and topology rules. Replace greedy first-fit allocation with deterministic, order-independent candidate selection (constrained-first ordering or scoring).

Done when:

- Adding a second function type (e.g. `USB device port`) requires only package/fixture data, zero resolver changes.
- `resolveHdmiFunctions` / `resolvePreferredI2cPairBindings` special-casing is gone.
- Resolution output is identical regardless of source edge array order (test-enforced).
- Generated pullups/termination come from generic topology rules, not hardcoded paths.

### M2 - Document model, patches, undo/redo - done (2026-07-11)

A real document API between UI/AI and the source graph: semantic patch operations (`setEdgeBindings`, `addNode`, ...), undo/redo, save/load of `project.nocad.json`.

Done when:

- The slice UI mutates only through the document API.
- Every edit is an inspectable patch; undo/redo works across all edit types.
- A project round-trips to disk and back losslessly.

## Intent / Semantic Graph Track

### G1 - North-star reference and semantic inventory - done (2026-07-11)

Establish the exact Pico RetroDigital revision being recreated and inventory the design before claiming semantic coverage. Decompose it into reviewable subsystems and identify every component, interface, power domain, generated support circuit, and board-relevant constraint that the graph must express.

Done when:

- The reference revision is content-pinned or otherwise immutable and its provenance, license status, known issues, and DRC baseline are recorded.
- A machine-checkable inventory maps reference components, nets, interfaces, and power domains to planned nocad packages and contracts, including explicit unsupported items.
- Subsystem boundaries and cross-subsystem interfaces are documented without changing electrical identity.
- Stable schematic pins, virtual power symbols, wires, labels, junctions, and no-connects are normalized and compared with PCB logical pin partitions; every difference is either fixed, explicitly excluded as non-electrical, or fingerprinted and exactly waived.

### G2 - Scalable graph composition and subsystem coverage - in progress

Extend the graph model and builder only where real north-star subsystems or the Initial Product Slice demonstrate a need. Likely semantic work includes hierarchy or grouping for navigation, reusable subsystem composition, package coverage, power and clock semantics, differential-pair and impedance constraints, placement hints, and generated passives. Product-level graph authoring must also fit into a workspace with multiple projects, package/module manifests, install and configuration flows, local overrides, AI-readable context, and AI-proposed structured patches. M2 supplies the patch and persistence foundation; M3 supplies the first real editor projection. Do not introduce abstractions solely to mirror KiCad syntax.

Done when:

- Each agreed subsystem can be authored and reviewed through the graph UI without raw JSON surgery.
- Packages and contracts cover the subsystem's real interfaces and constraints without component-specific resolver branches.
- Package/module manifests support explicit installation, configuration, versioned identity, and project-local overrides without losing source provenance.
- A workspace can host and reopen multiple projects, and exposes stable project context for validated, inspectable AI-proposed patches.
- Diagnostics distinguish missing package data, unsatisfied requirements, electrical conflicts, and intentionally unsupported reference features.
- Each completed subsystem has a deterministic resolution fixture and a reference-connectivity comparison.

### G3 - Full north-star semantic parity - todo

Compose all completed subsystems into one project and prove that nocad can represent the whole electrical design before board geometry is considered complete.

Done when:

- Every in-scope reference component and electrical connection has a stable nocad identity and source mapping.
- The full project can be authored, saved, reopened, and resolved without unexplained errors or raw JSON repair.
- A machine-readable connectivity comparison reports equivalence to the qualified reference, with every intentional difference explicitly waived and documented.
- Required board obligations and constraints are emitted for the PCB editor, including power domains, differential pairs, placement constraints, keepouts, and generated support circuitry represented by the semantic model.

## Editor / PCB Track

### M3 - Editor engine foundation + schematic projection (read-only) - done (2026-07-12)

Start the custom canvas engine (per CLAUDE.md hard rules: no React per document object). The first projection was a generated schematic view from the lockfile (symbols, generated nets, source-map hover), which now remains a derived read-only inspection surface while graph and PCB work take priority. Both projections share the portable engine. Rendering stack decision (custom thin WebGL2 renderer, no scene-graph library; three.js reserved for a possible later 3D preview) is recorded in `docs/research/pcb-layout-approach.md`.

Done when:

- Canvas engine renders the schematic projection of the HDMI TX sample with stable pan/zoom.
- Geometry/hit-testing primitives live in a portable core package (no React/Electron imports).
- Selection in the projection links back to intent graph objects.

Implemented with a portable `@nocad/editor-core` package and a single custom WebGL2 canvas. The general adapter projects authored electrical nodes, generated components, and resolved nets from project source plus lock output into deterministic scene geometry. Source references survive through bodies, ports, generated objects, and nets; canvas selection highlights the corresponding graph node or edge. The current lock does not yet carry authored component inventory, so this is source-plus-lock projection rather than lock-only projection.

### M4 - Board projection (read-only) - in progress

Render placements (from layout intent + package footprints) and ratsnest from the lockfile. Makes layout-aware pin-assignment scoring visible and debuggable.

Done when:

- Board view shows footprints, placement hints, ratsnest for a sample project.
- Pin-assignment scoring inputs/outputs are inspectable from the board view.

Portable board geometry, rotated hit testing, source mapping, overlap checks, authored/generated footprints, and multi-endpoint ratsnest projection are implemented. M4 remains in progress because pin-assignment scoring is not yet layout-aware or inspectable from the board view.

### M5 - Placement editing + `project.nocad.board.json` - todo

Authored board source file lands (stable-ID invariant enforced first; see `pcb-layout-approach.md`). Dragging writes exact coordinates into board source; intent hints score placements; courtyard-overlap DRC runs live.

Done when:

- Board file exists, is authored via the document API, and survives re-resolution of unchanged intent byte-identically in its references.
- Orphaned-geometry diagnostics fire when intent changes remove referenced nets.

### M6 - Obligations panel - todo

Constraint states (unplaced / unrouted / violating / satisfied) listed with click-to-locate. Useful before routing tools exist.

Done when:

- Every placement, routing, and declared-constraint obligation has a stable state and source mapping.
- Selecting an obligation locates the relevant graph or board objects.

### M7 - Manual routing MVP - todo

45-degree segments, vias, snap, live clearance DRC. No push-and-shove.

Done when:

- A user can route and edit all nets in the capability MVP using authored segments and vias.
- Live clearance checks and final DRC use the same portable rule implementation.
- Routing edits are inspectable, undoable board-document patches.

### M8 - KiCad export - todo

`.kicad_pcb` (and schematic) export as the escape hatch: place in nocad, finish in KiCad. Export before import.

Done when:

- The capability MVP exports to a supported KiCad version and opens without repair.
- Exported connectivity is machine-compared with the resolved nocad project.
- Unsupported or lossy constructs are reported explicitly rather than silently omitted.

### M9 - Declarative zones and pours - todo

Pours as intent ("GND pour on L2 with these keepouts", geometry generated). Zones are required for north-star manufacturing equivalence, not an optional routing convenience. Every result is ordinary inspectable board geometry and must pass the same DRC as manual geometry.

Done when:

- The north-star project's declared copper zones can be generated deterministically, inspected, regenerated, and exported.
- Manual edits and generated geometry have clear ownership so regeneration cannot silently destroy authored work.

## Cross-track Integration Gates

These gates are acceptance checkpoints, not a third implementation track. Passing one may expose work that belongs back in either track.

### I1 - Capability MVP connectivity - todo

The RP2350 + IT66121 sample is authored through the graph UI, resolves deterministically, exposes all provider requirements and generated circuitry, and has a machine-checkable expected netlist.

### I2 - Capability MVP board loop - todo

The same sample is projected, placed, manually routed, checked, persisted, reopened, and exported to KiCad with connectivity preserved. Pours are not required for this compact gate unless the sample declares them.

### I3 - North-star intent parity - todo

G3's complete graph passes the qualified reference connectivity comparison and produces no unexplained diagnostics. This gate can be reached before the full board is routed.

### I4 - North-star board parity - todo

The full project has its outline, stackup, footprints, placement, rules, keepouts, ratsnest, and obligations represented in nocad. Every reference element is mapped, intentionally replaced, or explicitly waived.

### I5 - North-star export qualification - todo

All required nets are routed, declared zones are generated, nocad DRC has no unexplained violations, and the exported KiCad design passes the documented connectivity and DRC comparison procedure. The KiCad export must preserve the fabrication-critical board definition needed to produce the qualified design, including stackup, outline and cutouts, copper, drills, mask, and fabrication layers. Nocad-native BOM, CPL, or Gerber generation is not required at this gate; those outputs may still be produced from the qualified KiCad export. Exact human trace geometry and global route optimality are not acceptance requirements.

## Nonblocking Automation and Routing Research

### A1 - Deterministic board assists - todo

Add user-directed operations that do not require a global router: differential-pair drawing assistance, pattern replication, fanout helpers, and corridor-constrained completion. Every result is an ordinary inspectable board patch and must pass the same DRC as manual geometry.

Done when:

- Differential-pair, fanout, replication, and corridor assists never bypass the board document or DRC path.
- Proposed geometry is deterministic for the same inputs, previewable before application, and undoable after application.
- Failure leaves the document unchanged and explains which declared rule or geometric condition prevented a proposal.

A1 is useful for north-star completion but does not block it; manual board editing remains the required path.

### M10 - Selected-net routing experiment - todo

Route one explicitly selected net at a time with fixed placement, existing copper, keepouts, allowed layers, width, and clearance supplied as inputs. This is a bounded local search experiment, not a commitment to whole-board autorouting or global optimality. The first acceptance fixture is a curated snapshot of the HDMI breakout described in `docs/research/pico-retrodigital-fixture-plan.md`.

Done when:

- Removing one simple management or control trace from the HDMI breakout fixture produces a well-defined unrouted obligation.
- The router either proposes a DRC-clean route or reports failure without mutating the document.
- A proposed route is deterministic for the same input and records its algorithm version, parameters, iteration count, elapsed time, and cost breakdown.
- The route is applied only through an inspectable, undoable document patch.
- The UI can overlay the proposal, existing geometry, explored region, and relevant cost or failure information in board coordinates.
- Success is measured by legality, bounded interactive behavior, and reviewability. Matching the original human route or proving optimality is not required.

M10 does not block the north-star milestones or integration gates. Global multi-net autorouting is deliberately not committed. Evidence from M10 must justify any later experiment in net ordering, congestion pricing, local rip-up-and-reroute, partitioning, or learned ranking. A useful system may route only a selected region or subset and identify the remaining placement or constraint conflicts.

## Architecture Invariants

Short list; violating one is a design regression, not a style issue:

1. Function nodes are implementation-agnostic. "How" is provider topology (provides edges, modes, upstream contract edges). If a feature seems to need per-implementation function nodes, implementation detail is leaking.
2. Generated IDs are stable, deterministic functions of source IDs. Board geometry and external references depend on it.
3. Geometry is authored; obligations are generated. The resolver never regenerates the board file wholesale; it proposes patches.
4. EDA core stays portable: no React, no Electron imports; WASM-friendly data layouts on hot paths.
5. Editor documents are never rendered as one React component per object.
6. AI and tools edit through inspectable, undoable patches addressed by stable IDs; never silent mutation, never `R12`-style identity.
7. Routing automation is progressive and fallible. Manual geometry, deterministic assists, and selected-net search share one patch and DRC path; no router bypasses validation or silently changes placement, constraints, or locked geometry.
8. Engine and production UI behavior is definition-driven. Portable modules and workspace components never compare protocol, signal, component, feature, or project IDs to choose logic, controls, layout, rendering, or interaction behavior. Specific fixtures belong only in test data or isolated development surfaces.
9. Production component definitions live outside the engine and application, load through the component-library boundary, identify a real manufacturer part, disclose definition coverage, and carry content identity. Generic stand-ins may exist only as test-local definitions.

## Open Decisions

- Board file granularity: one board file per board from the start (multi-board vision) or single file until needed. Decide before M5.
- KiCad export timing: M8 can be pulled earlier (placement-only export) if adoption/testing demands it.
- Package distribution: how hashed component packages are fetched, installed, updated, and overridden beyond the current built-in asynchronous source.

## History

- 2026-07-12 - Prioritized the semantic graph and PCB workflow while freezing schematics as a generated read-only debugging view. Added general authored multi-endpoint physical nets with deterministic validation, hard pin reservations, conflict invalidation, canonical endpoint arrays, and explicit source-map realization links that reconcile compatible semantic intent into one physical net identity. Added edge-owned generated-component substitution with explicit terminal maps so captured series-component segments can replace resolver-generated topology without losing semantic ownership. Started M4 by moving rotated board geometry, hit testing, source maps, overlap DRC, and multi-endpoint minimum-spanning ratsnests into the portable editor core; board selections now link back to source graph objects. M4 remains in progress pending layout-aware, inspectable pin-assignment scoring.

- 2026-07-12 - Completed M3 with portable geometry, pan/zoom transforms, rendering-neutral scene primitives, deterministic schematic auto-layout, and hit testing in `@nocad/editor-core`. Added a single-canvas WebGL2 schematic workspace with fit/pan/zoom, labels, source-map hover, and graph-linked node/edge selection. Started G2 with a pinned, source-free logical-interface fixture for the real RP2354B-to-TE-video-FFC path; it records exact manual active-signal bindings while explicitly excluding unqualified series, bias, power, and HPD details.

- 2026-07-12 - Enforced the general interpreter boundary across engine and UI. Resolver, assignment, and board projection now consume injected catalogs; routing presentation, board envelopes, preferred groups, provider presets, and connection roles come from data; project provenance is computed as SHA-256; production workspace code contains no protocol/component feature branches; and KiCad/demo surfaces are isolated. Added runtime-verified, dynamically loaded component/contract/function definitions for real RP2350A, RP2354B, IT66121, and TE 1-1734839-4 paths. Removed the generic FPGA from shipped palettes and demos while retaining generic pin-pool semantics in test-local definitions.
- 2026-07-11 - Completed G1 with a content-pinned schematic-connectivity capture. All 337 physical pin UUIDs, 60 virtual power symbols, 133 wires, 32 junctions, 158 labels, 20 explicit no-connect markers, and three intrinsic no-connect pins have stable net membership. Source-free verification independently derives the PCB logical pin partitions and proves exact connectivity for every represented pin. Twenty-two blank, mounting, and thermal pads are exact non-electrical exclusions; J5's unused A8/B8 SBU pads have one fingerprinted waiver; duplicate C5 physical implementation remains a separately checked identity issue. Licensing, current DRC/ERC, fabrication, and hardware testing remain explicit qualification unknowns, so the reference is still non-golden.
- 2026-07-11 - Started G1 with a source-free, content-pinned Pico RetroDigital main-board inventory. Separate design/evidence aggregates pin the dirty working tree and stale artifacts; PCB pad UUIDs yield per-net and whole-connectivity digests; all physical components have one subsystem owner and package status; every cross-subsystem net has one interface/power declaration; and stackup, netclasses, differential pairs, the custom small-via rule, zones, support circuits, rights, DRC/ERC, fabrication, and hardware-test status are recorded. Self-contained verification and mutation checks run under `pnpm test`. G1 remains active because schematic-wire and individual virtual power-symbol membership are not yet normalized or compared with the PCB view.
- 2026-07-11 - Completed M2 integration in the React slice. One `ProjectDocument` now backs `useSyncExternalStore`; graph, inspector, diagnostic suggestion, and placement gestures dispatch semantic patches; compound edits are atomic; resolver and delayed-dialog operations carry captured revisions; undo/redo preserves ephemeral positions while reconciling selection; and browser load/save uses validated, lossless `project.nocad.json` serialization with non-destructive errors.
- 2026-07-11 - Started M2 with the intent-core `ProjectDocument`. Stable-ID patches cover current source edits and atomic batches, successful edits retain inspectable inverses, undo/redo restores exact ordering and optional containers, stale revisions are rejected, snapshots are immutable and subscription-safe, and validated JSON save/load preserves unknown future keys. The React slice still needs migration before M2 is complete.
- 2026-07-11 - Completed M1 with generic inline series interposers. Function package data now selects signal groups, enable/value fields, component terminals, dependencies, IDs, and near-endpoint placement hints. Active HDMI termination splits each TMDS conductor into provider and connector nets around one generated resistor; off mode preserves the original net, invalid/duplicate rules diagnose without implicit chains, and a non-HDMI fixture exercises the same resolver path. Generated components and both split segments survive board projection.
- 2026-07-11 - Completed the M1 resolver-determinism slice. Canonical edge processing now invalidates every duplicate-ID occurrence, diagnoses conflicting hard reservations and ambiguous function topology, preserves canonical generated-dependency provenance, protects only validated explicit/fixed provider claims, and uses stable constrained-first provider allocation. Full `ResolvedProject` equality is tested across all edge permutations for mixed success, pressure, diagnostic, suggestion, provider-requirement, and malformed cases. The allocator remains bounded and two-phase rather than globally optimal; generic inline series termination still blocks M1 completion.
- 2026-07-11 - Adopted the Pico RetroDigital main board as the product north star and reorganized delivery into shared M1-M2 foundations, cooperating semantic-graph and editor/PCB tracks, explicit cross-track integration gates, required M9 zones, and nonblocking board-assist and M10 selected-net routing research.
- 2026-07-11 - Added metadata-driven provider requirement sockets to the graph. HDMI transmitter requirements now appear as separate `Video In` and `I2C Control` target handles with open/connected state, exact port/contract drops, duplicate protection, and attached existing edges.
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
