# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo Layout

This checkout uses a bare-repo + worktree pattern: the bare repo lives in `.bare/` and the active worktree is `main/`. Run all commands from `main/` (the workspace root with `package.json`, `pnpm-workspace.yaml`, and `turbo.json`).

Monorepo structure:

- `apps/web` — Vite + React 19 + Tailwind v4 web workspace (`@nocad/web`). Runs on `http://127.0.0.1:3000`.
- `packages/eslint-config` — shared ESLint flat config (`base.js`, `react.js`).
- `packages/typescript-config` — shared `tsconfig` presets (`base`, `node`, `react-app`).
- `packages/vitest-config` — shared Vitest config (jsdom + globals + tsconfig-paths).
- `docs/research/` — product vision and research notes.

Node 22.14 (see `.nvmrc`), pnpm 10, Turborepo 2. Only `esbuild` is in `onlyBuiltDependencies`.

## Development Commands

Run from `main/`:

```bash
nvm use
pnpm install
pnpm dev          # turbo run dev (web app on 127.0.0.1:3000)
pnpm build        # tsc --noEmit + vite build per workspace
pnpm typecheck
pnpm lint
pnpm lint:fix
pnpm test         # turbo run test
```

Per-package:

```bash
pnpm --filter @nocad/web dev
pnpm --filter @nocad/web typecheck
```

Run a single Vitest test file (Turbo isn't needed for ad-hoc runs):

```bash
pnpm --filter @nocad/web exec vitest run src/path/to/file.test.tsx
pnpm --filter @nocad/web exec vitest run -t "test name pattern"
```

There are no tests yet; `@nocad/web`'s `test` script runs `vitest run --passWithNoTests`, so `pnpm test` is green on the empty repo. The shared Vitest config (`packages/vitest-config`) sets `jsdom` + `globals` and wires `vite-tsconfig-paths`, so the `@/*` alias works in tests too.

shadcn/ui is configured in `apps/web/components.json` (style: new-york, base: neutral, icons: lucide). Add components from `main/`:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Generated components land at `@/components/ui` and share the `cn()` helper in `@/lib/utils` (clsx + tailwind-merge) — not the stray empty `src/ui/` directory. The `@/*` alias maps to `apps/web/src/*` (set in `apps/web/tsconfig.json` and resolved at build time by `vite-tsconfig-paths`).

## Architecture & Direction

nocad is a desktop-first, collaborative electronics design tool — a "Notion of KiCad" for schematics, PCB, docs, comments, and history. AI is a first-class product surface, not a chat bolt-on.

Layering the codebase should grow into:

```
Electron shell        windowing, FS, native menus
React UI              app chrome: nav, inspectors, command palette, dialogs
Editor engine         canvas/WebGL/WebGPU rendering, hit testing, selection, overlays
EDA core              document model, netlist, ERC/DRC, geometry, import/export  (portable; future Rust/C++ -> WASM)
Sync layer            undo/redo, local-first storage, multiplayer
AI layer              context retrieval, tool-callable edits, explanations, reviews
```

Hard rules for that growth:

- **Do not render editor documents as one React component per object.** The schematic/PCB surface is a custom canvas/WebGL/WebGPU engine; React is only for chrome.
- **Keep EDA core portable.** Document model, netlist, ERC/DRC, geometry, import/export, and routing must not import Electron or React. Plan for a future Rust/C++ core compiled to WASM.
- **AI operates on structured data.** Project state must be queryable and safely editable by tools. Prefer proposed, inspectable, undoable patches over silent mutation. Don't build AI features around screenshots when the document model can expose symbols, nets, constraints, geometry, and history.

## Product Priorities

Start with schematics before PCB layout. Bias early work toward: clean document model, reliable undo/redo, ergonomic selection/editing primitives, local save/load, KiCad file format research, AI-readable project context, and tool-callable editing operations.

Avoid early effort on: marketing pages, decorative UI, premature autorouting, full KiCad feature parity, Electron coupling inside core EDA logic, and screenshot-based AI workflows where structured data exists.

## UI Principles

- Build the actual tool as the first screen — no landing page.
- Keep operational UI quiet, dense, keyboard-driven, inspector-driven.
- Keep the editor viewport fast and visually stable during pan/zoom/pointer movement.
- AI suggestions must be visible, reviewable, and reversible.

## Repo State

The repo currently contains scaffolding only. `apps/web/src/App.tsx` is an empty `<main>`; `main.tsx` mounts it under a `ThemeProvider` (`defaultTheme="system"`, `storageKey="nocad-theme"`) whose implementation lives in `src/components/` (`theme-provider.tsx`, `theme-context.ts`, `use-theme.ts`). Everything else is shared config. Before assuming deeper architecture exists, inspect the tree.
