# CLAUDE.md

Guidance for AI agents working in this repository.

## Project Intent

nocad is a desktop-first, collaborative electronics design tool. Think "Notion of KiCad": a modern workspace for schematics, PCB design, documentation, comments, and project history.

AI support is central to the product. Optimize for a real product architecture, not a quick demo. React is appropriate for app UI, but the schematic/PCB editor surface should be treated as a custom rendering and interaction engine.

## Technical Direction

- Use pnpm + Turborepo for JavaScript/TypeScript workspace orchestration.
- Use Electron for the desktop shell unless the project explicitly pivots.
- Use React for menus, sidebars, inspectors, command palette, dialogs, settings, and collaboration UI.
- Do not render large editor documents as one React component per object.
- Use a custom canvas/WebGL/WebGPU layer for editor rendering, hit testing, zoom, pan, hover, selection, and overlays.
- Keep EDA logic portable. Document model, netlist generation, ERC/DRC, geometry, import/export, and routing should be isolated from Electron-specific code.
- Prefer Rust or C++ for a future core that can run as WASM or native code.
- Treat AI as a first-class architecture concern. Core project state should be structured, queryable, explainable, and safely editable by AI tools.

## Development Commands

```bash
nvm use
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm test
```

Per-package examples:

```bash
pnpm --filter @nocad/web dev
pnpm --filter @nocad/web build
pnpm --filter @nocad/web typecheck
```

shadcn/ui is configured in `apps/web/components.json`. Add components from the repo root with:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

## Current Repository Structure

- `apps/web` - Vite/React web workspace.
- `packages/eslint-config` - shared ESLint flat config.
- `packages/typescript-config` - shared TypeScript configs.
- `packages/vitest-config` - shared Vitest config.

## AI Product Requirements

AI support is not just chat. It should become a design partner that can understand and modify the project through explicit tools and reviewable changes.

Prioritize AI capabilities that can use structured data:

- explain a schematic, module, component, net, or design decision
- review ERC/DRC issues and propose fixes
- search for parts and compare tradeoffs
- read datasheets and reference designs
- calculate component values and operating limits
- generate project documentation and design notes
- propose schematic edits as inspectable patches
- propose layout edits using design rules and geometry constraints
- answer questions from project history, comments, and linked docs

AI-generated edits should be controlled:

- prefer proposed patches over silent mutation
- keep changes undoable
- preserve provenance where useful
- validate edits against the document model and ERC/DRC checks
- expose enough reasoning for users to trust or reject changes

## Product Priorities

Start with schematics before PCB layout.

Early work should bias toward:

- clear document model
- reliable undo/redo
- ergonomic selection and editing primitives
- local save/load
- KiCad file format research
- room for collaboration later
- AI-readable project context and tool-callable editing operations

Avoid spending early effort on:

- marketing pages
- decorative UI
- premature autorouting
- full KiCad feature parity
- Electron-specific coupling inside core EDA logic
- screenshot-only AI workflows when structured data is available

## UI Principles

- Build the actual tool as the first screen.
- Keep operational UI quiet, dense, and predictable.
- Use React component libraries for app chrome, not for high-volume canvas rendering.
- Prefer keyboard-accessible commands and inspector-driven editing.
- Keep the editor viewport fast and visually stable during pan, zoom, and pointer movement.
- Make AI suggestions visible, reviewable, and reversible.

## Repo State

The repository has initial web app tooling. Before assuming deeper app architecture exists, inspect the repo.
