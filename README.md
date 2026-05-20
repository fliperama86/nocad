# nocad

nocad is an experiment toward a collaborative, web-native electronics design tool: the "Notion of KiCad."

The goal is not to clone KiCad's desktop UI. The goal is to make schematic and PCB design feel local-first, multiplayer, searchable, scriptable, AI-native, and deeply integrated with project documentation.

## Direction

- Desktop-first app built with Electron.
- React for the product UI: navigation, inspectors, command palette, dialogs, settings, and collaboration surfaces.
- Custom canvas/rendering layer for schematic and PCB editing.
- Portable EDA core in Rust or C++ for document modeling, KiCad import/export, netlists, ERC/DRC, geometry, and routing experiments.
- Local-first persistence with a path toward real-time collaboration.
- AI support as a first-class product surface and architecture constraint, not an afterthought.

## AI-Native Workflow

AI should help users design, inspect, explain, and safely modify electronics projects.

Expected capabilities include:

- conversational project assistant with full design context
- schematic explanation and review
- part search and selection support
- datasheet and reference design understanding
- ERC/DRC issue explanation and suggested fixes
- netlist-aware edits
- component value calculations
- design-rule-aware layout suggestions
- generated documentation, changelogs, and design notes
- controlled edit proposals that users can inspect before applying

AI features should operate on structured project data wherever possible. Avoid building core AI behavior around screenshots or brittle text scraping when the document model can provide explicit symbols, nets, constraints, components, geometry, and history.

## Early Scope

Start with schematics before PCB layout:

- project/workspace shell
- schematic pages
- symbols, wires, labels, and net model
- selection, pan, zoom, and editing primitives
- properties inspector
- KiCad import/export research
- local save/load
- AI-readable project context and safe AI edit proposals

## Architecture Sketch

```txt
Electron
  windowing, filesystem, native menus, local integration

React
  app shell, project navigation, inspectors, command palette

Editor engine
  viewport, canvas/WebGL/WebGPU rendering, hit testing, selection, overlays

EDA core
  document model, netlist, ERC/DRC, geometry, import/export

Sync layer
  undo/redo, local-first storage, multiplayer state

AI layer
  project context retrieval, tool calls, constrained edits, explanations, reviews
```

## Status

This repository is just being initialized.
