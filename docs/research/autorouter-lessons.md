# Research Note: Lessons From Building An Autorouter

Status: reference note

Captured: 2026-07-10

## Sources

- [Original X thread](https://x.com/seveibar/status/1905443905979715725), posted by Seve Ibarluzea on 2025-03-28.
- [Expanded article: "13 things I would have told myself before building an autorouter"](https://blog.autorouting.com/p/13-things-i-would-have-told-myself), published on 2025-03-28.
- [Hacker News discussion](https://news.ycombinator.com/item?id=43499992), useful for counterpoints from PCB designers and algorithm developers.

## Context

The author wrote these lessons after about a year of developing the open-source tscircuit autorouter in TypeScript. The router is described as a pipeline with 13 stages and roughly 20 measured sub-algorithms. The article is an engineering retrospective, not a controlled benchmark or literature review. Its absolute statements should therefore be read as strong heuristics from one implementation.

General routing contains NP-hard and NP-complete formulations, but this does not make every routing operation equally difficult. Fixed-geometry validation and many single-net shortest-path formulations are tractable, while multi-net competition, optimal multi-pin trees, net ordering, and placement plus routing introduce combinatorial difficulty. nocad's staged response is specified in `pcb-layout-approach.md` and tracked in roadmap M7, M9, and M10.

## The 13 Lessons

### 1. Learn A* deeply and apply informed search broadly

A* is useful beyond shortest paths on a two-dimensional grid. The important pattern is to rank the next candidate using both accumulated cost and an estimate of remaining cost, rather than exploring neighbors uniformly. The tscircuit work also applies this idea at a meta level, allocating more iterations to promising router and hyperparameter configurations.

### 2. Improve the algorithm before changing the language

Performance has two main levers:

1. Reduce the number of iterations.
2. Reduce the cost of each iteration.

The article argues that iteration count usually dominates early development. A high-level language that enables faster experimentation can outperform a lower-level implementation of a poor algorithm. This does not mean runtime or data layout never matters; it means language migration should follow profiling and algorithmic work.

### 3. Consider spatial hashing before tree indexes

A spatial hash maps geometry into fixed-size cells and uses hash lookup to retrieve nearby objects. It can be simpler and more cache-friendly than a quadtree for suitable object distributions. Cell size is a workload-specific parameter, so it must be selected and benchmarked rather than assumed.

### 4. Partition for reuse and cache solved subproblems

Large routing problems contain repeated local patterns. If stages operate on stable spatial partitions with cacheable inputs and outputs, previously solved regions can be reused after local edits. The article expects partitioning and large caches to matter more than small improvements in raw solver speed.

### 5. Build a visualization for every algorithmic problem

Visual fixtures expose geometry errors, bad heuristics, and wasted exploration more effectively than scalar logs alone. The author reports starting some sub-algorithms with their visualization and using overlays to compare each stage's input and output.

### 6. Profile before optimizing

Browser performance tooling, line-level timings, flame charts, and memory views made JavaScript performance problems observable. The general lesson is independent of JavaScript: measure stage time, hot paths, allocations, and iteration counts before deciding what to rewrite.

### 7. Prefer explicit iteration state over recursion in hot search code

The author avoids recursive implementations because explicit work queues make it easier to:

- pause or animate a search;
- change DFS-like behavior into priority-driven search;
- count and budget iterations;
- share mutable visited-state efficiently; and
- inspect or resume solver state.

This is a design preference for observable, controllable search loops, not a universal prohibition on recursion.

### 8. Use random search as a probe, not the default final solver

Monte Carlo and simulated annealing can produce an initial baseline when a candidate can be scored but the constructive heuristic is unknown. The author prefers replacing them with deterministic heuristics and richer cost functions once the problem is understood, primarily for reproducibility and debugging.

The Hacker News discussion pushes back on the blanket rejection. Randomized methods can be valuable for escaping local minima, producing fast approximate answers, and checking a more complex solver. For nocad, the practical requirement is reproducibility: any stochastic stage must accept and record a seed, report its budget, and remain comparable against deterministic baselines.

### 9. Keep intermediate stages in a common coordinate system

Normalizing each subproblem into an isolated coordinate space can hide how an early-stage decision causes a later failure. Keeping inputs, intermediate results, and outputs grounded in board coordinates makes pipeline overlays and cross-stage diagnosis easier.

### 10. Animate iterations

An animation can reveal a solver expanding indefinitely, repeatedly reconsidering equivalent states, or spending most of its budget in irrelevant regions. This complements profiling: a flame chart shows where time is spent, while an iteration animation shows why.

### 11. Benchmark exact geometry before rasterizing to a grid

Segment intersection and distance math can be cheaper than populating and scanning a high-resolution occupancy grid. Grids also introduce resolution choices and memory traffic. Exact vector geometry should be the baseline for trace-to-trace checks, with spatial indexes limiting the candidate set.

Raster representations remain useful where their tradeoffs fit the operation, such as coarse congestion maps or learned image models. The point is not to use a grid automatically for every collision query.

### 12. Predict failure at each stage and prioritize solvability

The router estimates the probability that local capacity nodes will fail in later stages. Earlier stages then try to reduce that risk. The broader strategy is to obtain a valid complete solution first and improve it incrementally, rather than making every early decision optimal and risking no solution at all.

### 13. Trade optimality for speed with Weighted A*

Standard A* ranks a node using:

```txt
f(n) = g(n) + h(n)
```

Weighted A* increases the influence of the estimated remaining cost:

```txt
f(n) = g(n) + w * h(n)
```

For `w > 1`, the search becomes greedier and can finish much faster, at the cost of the optimality guarantee of ordinary A*. The weight should be an explicit, measurable policy rather than a hidden magic constant.

## Claims To Treat As Hypotheses

Several article headings are intentionally absolute. They should become benchmark questions, not nocad architecture rules:

- Is a spatial hash faster than an R-tree, BVH, sweep structure, or hybrid index for nocad's actual geometry and edit patterns?
- At what board size and workload does TypeScript stop meeting latency targets, and which measured kernels should move to Rust/WASM?
- Which routing subproblems are reusable after component movement, constraint changes, or neighboring route edits?
- When does exact vector math beat a grid, and when is a coarse grid the better congestion representation?
- Which randomized techniques improve route completion or escape local minima enough to justify their reproducibility cost?
- Which A* heuristic and weight produce useful interactive latency without unacceptable route quality?

## Implications For nocad

### Keep autorouting out of the early critical path

This research reinforces the existing sequence in `pcb-layout-approach.md`: document model, obligations, placement, deterministic geometry, manual routing, and DRC come before full autorouting. A router without structured constraints and a correctness checker can optimize the wrong objective very quickly.

### Design for human-in-the-loop assistance

The most useful early automation is likely local and reviewable:

- route one selected net or bus;
- complete a short gap;
- replicate a validated pattern;
- propose alternatives under explicit constraints;
- show cost, violations, and affected geometry before application; and
- accept, reject, or undo the result as a normal document patch.

The Hacker News discussion emphasizes that working PCB designers often want partial assistance after placement and critical-route decisions, not a one-click replacement for the entire layout process.

### Make the pipeline observable from its first prototype

Every future placement or routing stage should expose:

- stable input and output snapshots;
- stage and total iteration counts;
- elapsed time and allocation metrics;
- cost decomposition, not only a single score;
- DRC and obligation status before and after;
- spatial overlays in original board coordinates; and
- deterministic replay data, including random seeds where applicable.

These are debugging interfaces first. They could later become user-facing explanations for AI or assisted-layout proposals.

### Preserve cacheable identities

The existing stable-ID invariant is a prerequisite for useful solver caching. A cache key for a local problem should eventually include the relevant geometry, nets, constraints, stackup, clearance rules, algorithm version, and solver parameters. It must not depend on unrelated document ordering or regenerated labels.

### Benchmark the geometry kernel with representative boards

`pcb-layout-approach.md` currently proposes an R-tree plus exact hit testing. This note does not overturn that choice. It adds a requirement to benchmark spatial hashing and hybrid indexes for hot operations such as clearance candidates, hit testing, ratsnest updates, and local rerouting. The portable interface should not expose the chosen index type to callers.

## Resulting Research Questions

1. What is the smallest local routing problem that exercises nocad's constraint and patch model without creating an autorouter milestone?
2. Which intermediate artifacts should be first-class debug data, and which can remain transient?
3. Can board edits invalidate cached regions precisely using stable geometry and intent IDs?
4. What route-quality cost terms correspond directly to nocad obligations, including clearance, layer policy, differential pairing, length matching, via count, and keepouts?
5. How should the UI compare two proposed routes without presenting a misleading single quality score?
