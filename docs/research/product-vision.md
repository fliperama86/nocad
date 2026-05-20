# Product Vision: nocad

nocad is an experiment toward a collaborative, AI-native electronics design workspace: the "Notion of KiCad."

The core thesis is that existing EDA tools expose too many low-level implementation mechanics where users want to work with design intent. nocad should let users manipulate reusable, structured electronics design objects and then materialize the schematic, PCB layout, BOM, fabrication outputs, documentation, and review history from that model.

## Problems To Solve

### Reuse Is Too Weak

KiCad supports hierarchical sheets and reusable blocks, but they are not enough for real design reuse. A useful reusable RP2350 scaffold, for example, should include the MCU, decoupling capacitors, crystal circuit, boot/reset/debug parts, schematic fragment, footprint choices, layout guidance, constraints, BOM mappings, fabrication assumptions, and design notes.

In current workflows, this reuse often collapses into copy/paste, brittle sheets, manually managed references, and disconnected PCB work. It works poorly for schematics and barely addresses PCB layout reuse.

### The Tool Feels Too Low-Level

KiCad often feels closer to MS Word than Notion: flexible, but too manual. Placing an IC should not force users to manually wire every pin, invent global labels, and keep a pile of hidden conventions in their head.

nocad should be more tunneled and opinionated. Users should be able to express intent like connecting a USB-C power module to a board power domain, or wiring an MCU peripheral to a connector, and the tool should create, validate, and explain the concrete nets, constraints, labels, and layout implications.

### Routing Is Time-Consuming And Error-Prone

Routing remains one of the most expensive and fragile parts of board design. AI can help substantially, but AI should not be the only routing mechanism. The editor still needs deterministic geometry, constraints, validation, collision checks, diffable edits, and undoable patches.

AI should propose, explain, and orchestrate routing work. The tool should validate and apply it safely.

### IDs And References Are Brittle

Reference designators, UUIDs, labels, and library links are easy to break or desynchronize. User-facing names like `R12` should not be the real source of truth.

nocad should use stable internal identities, semantic roles, and history-aware references. User-visible labels can be regenerated, renamed, or rearranged without breaking the design model.

### Fabrication Output Is Too Manual

Producing files for manufacturers such as JLCPCB should be a guided workflow, not a maze of export options.

nocad should provide fabrication profiles with sane defaults, validated Gerbers, BOM, CPL, part availability checks, warnings, and predictable output bundles. BOM management should be part of the design model, not an afterthought.

### File Formats Are Hard For Tools And AI

AI and automation should not have to reverse engineer a pile of loosely related schematic, PCB, library, and manufacturing files. Import/export compatibility matters, but the internal model should be explicit, structured, and queryable.

The document model should expose components, nets, constraints, modules, placements, geometry, manufacturer mappings, comments, design decisions, and history in a way that both deterministic tools and AI agents can operate on.

### Multi-Project And Multi-Board Workflows Are Poor

Users often need to open several projects at once for reference, reuse, or comparison. A single-window, single-project workflow blocks that.

nocad should treat the workspace as the top-level object. A workspace can contain multiple projects, multiple boards, shared modules, shared packages, shared parts, and reference designs.

Multi-board designs should be native. A "project" should not imply exactly one schematic and one PCB.

### Schematic And PCB Should Be Views, Not Separate Worlds

The schematic versus PCB distinction is useful internally, but it should not feel like two separate applications glued together by fragile annotation and update flows.

nocad should model one design graph with multiple projections: schematic views, PCB layout views, BOM views, documentation views, manufacturing views, and AI review views.

## Product Principles

### Design Intent Over Drawing Mechanics

Users should work with meaningful design objects:

- modules
- components
- nets
- interfaces
- power domains
- constraints
- packages
- manufacturing targets
- design decisions

The tool should translate intent into schematic representation, layout constraints, BOM entries, and fabrication outputs.

### Reusable Modules Should Be Open, Linked, And Forkable

Reusable design blocks should not be black boxes by default, and they should not be dumb copied templates.

A module should be:

- inspectable
- editable
- versioned
- linked to its source
- locally overrideable
- diffable when updates are available
- forkable when a design diverges

An RP2350 module might include:

- RP2350 symbol and footprint
- decoupling network
- crystal circuit
- boot/reset/debug circuitry
- USB wiring constraints
- known-good layout cluster
- JLCPCB part mappings
- design notes
- version history

When a new upstream version is available, the user should get a reviewable update, similar to software dependency upgrades:

```txt
RP2350 Minimal Module v1.3 -> v1.4 available

Changes:
  - updated recommended decoupling capacitor
  - added errata note for ADC reference
  - changed JLCPCB part number
  - improved USB pair constraints

Your instance has local edits:
  - custom crystal
  - moved SWD header

Apply:
  [accept part mapping update]
  [accept notes update]
  [review decoupling change]
  [skip USB layout change]
```

### Electronics Design Should Have Packages

nocad should treat reusable electronics design blocks like package-managed dependencies: versioned, installable, inspectable, configurable, updateable, forkable, and fabrication-aware.

Packages are not just symbols or footprints. A package can contain:

- schematic fragments
- PCB layout fragments
- symbols
- footprints
- 3D models
- constraints
- part mappings
- BOM rules
- fabrication profiles
- reference docs
- test procedures
- AI-readable design notes
- examples

Example package operations:

```txt
nocad add rp2350-minimal
nocad add usb-c-power-input
nocad add buck-5v-to-3v3 --target jlcpcb
```

Example dependencies:

```txt
@raspberrypi/rp2350-minimal@1.4.2
@nocad/usb-c-2layer-jlcpcb@0.8.1
@ti/tps62177-buck@2.1.0
```

Example package metadata:

```txt
compatible_boards: 2-layer, 4-layer
assembly: jlcpcb-basic, jlcpcb-extended, hand-solder
voltage_domains: 3v3
interfaces: usb2, swd, gpio
constraints:
  - crystal must be within 8mm of MCU pins
  - USB D+/D- require differential pair routing
  - decoupling caps must be placed near power pins
```

Packages should support local overrides and upgrades:

```txt
Dependencies
  @raspberrypi/rp2350-minimal  1.4.2  update available
  @jlcpcb/usb-c-connector      0.3.0  part unavailable
  @ti/tps63020-buck-boost     2.0.1  local overrides
```

### AI Should Be A First-Class Design Partner

AI support is central to nocad, not a later chat sidebar bolted onto the product.

The AI should interact with structured project data and explicit editing tools. It should not be forced to operate primarily through screenshots, brittle text scraping, or opaque file patches.

AI should be able to:

- explain a schematic, module, component, net, or design decision
- review ERC/DRC issues and propose fixes
- search for parts and compare tradeoffs
- read datasheets and reference designs
- calculate component values and operating limits
- generate project documentation and design notes
- propose schematic edits as inspectable patches
- propose layout edits using design rules and geometry constraints
- answer questions from project history, comments, and linked docs
- install, configure, and update packages

AI-generated edits should be controlled:

- prefer proposed patches over silent mutation
- keep changes undoable
- preserve provenance where useful
- validate edits against the document model and ERC/DRC checks
- expose enough reasoning for users to trust or reject changes

Example AI workflow:

```txt
User:
  Add USB-C power input for a 2-layer JLCPCB board.

AI:
  Found 3 compatible packages.
  Recommended @nocad/usb-c-power-jlcpcb because:
    - all parts are available at JLCPCB
    - supports 5V input
    - includes ESD protection
    - has a 2-layer layout fragment
    - passes included ERC/DRC checks

  Proposed change:
    - add module instance
    - connect VBUS to board 5V domain
    - add CC resistors
    - add ESD protection
    - apply JLCPCB BOM mappings
```

## Architecture Implications

### Internal Model

The internal model should represent design intent directly:

- workspaces
- projects
- boards
- schematic pages
- components
- modules
- package dependencies
- module instances
- local overrides
- nets
- interfaces
- power domains
- constraints
- placements
- routes
- ERC/DRC findings
- BOM items
- fabrication profiles
- comments
- design history

KiCad compatibility can be import/export. It should not dictate the internal model.

### Module Model

The module system should distinguish:

- module definition
- module version
- module instance
- instance configuration
- instance overrides
- local fork
- upstream update diff
- constraints and invariants

This is what allows reusable design blocks to behave like software dependencies while remaining editable in real hardware projects.

### AI Tooling Surface

The AI layer should have tools for querying and editing the design graph:

- list components, nets, modules, and constraints
- inspect a package or module
- propose a module installation
- propose a connection
- propose a schematic edit
- propose a placement or routing edit
- run ERC/DRC
- explain validation failures
- generate documentation
- produce fabrication output summaries

The most important design rule: AI should propose structured, reviewable changes that the core validates before applying.

## Initial Product Slice

The first useful slice should focus on schematics and package-managed modules:

- workspace shell
- multiple projects/windows
- schematic editor basics
- structured design graph
- package/module manifest format
- installable example module, such as RP2350 minimal
- local overrides
- stable internal IDs
- AI-readable project context
- AI-proposed edits
- KiCad import/export research
- early JLCPCB fabrication profile research

PCB layout can follow once the design model, module system, and AI edit workflow are proven.
