<p align="center">
  <img src="apps/web/public/icon-192.png" width="100" height="100" alt="WorkspaceTree Logo" />
</p>

# WorkspaceTree

> [中文版](README_zh.md) | [Live demo](https://panwanke.github.io/workspacetree/)

WorkspaceTree is a browser-based, local-first topological workspace canvas for organizing projects as living trees of dated nodes. Explore dual-mode timelines, write Markdown with live preview, manage 5-state tasks, and gain holistic architectural visibility.

<p align="center">
  <img src="docs/images/demo-showcase.png" width="100%" alt="WorkspaceTree Official Interactive Showcase and Tree Aesthetics" />
</p>

**Prototype:** This project is in active development and is not intended for production project data. Keep separate backups of anything you experiment with.

## Official Showcase & Architecture Philosophy (Art, Engineering & Philosophy)

WorkspaceTree is far more than a conventional mind map or task board; it embodies a dynamic equilibrium among **Artistic Rhythm**, **Engineering Rigor**, and **Philosophical Order**.

In our official interactive showcase project (**"WorkspaceTree · Technology Panorama & Architectural Evolution"**), we put this philosophy into full practice:

### 1. The Triadic Equilibrium

- **Engineering Rigor**: Deterministic pure-function layout algorithms (zero DOM dependencies), dual-axis (Timeline Tree + Date-First) geometric constraints, AABB collision avoidance, Local-First offline persistence, and microsecond-level hash isolation. Without engineering certainty, spatial aesthetics degrade into clutter.
- **Artistic Rhythm**: Rejecting the monotonous sterility of rigid grids, WorkspaceTree introduces **staggered visual pacing ("错落有致")**. By leveraging **Branch Scaling (`branchScales`)** to modulate subtree density and **Node Scaling (`nodeScales`)** to anchor tactical focus, combined with smooth cubic Bezier connections, restrained Callout alerts, and inline Pele / Mermaid flowcharts, the canvas breathes with life.
- **Philosophical Order**: The dialectic synthesis of macro architectural elevation and micro execution flow; the orthogonal harmony of chronological progression (Chronos) and structural hierarchy (Logos); disciplined divergence and deliberate convergence toward key release milestones.

### 2. Built-in Tree Aesthetics & Typographic Guide Node

The showcase includes a dedicated master guide node (**"Tree Layout Aesthetics & Philosophy Guide"**, ID: `n_layout_philosophy`), detailing:

- **Card Layout & Typography**: Anchoring visual gravity with headers, applying restrained Callouts (`[!IMPORTANT]`, `[!TIP]`, `[!NOTE]`, `[!WARNING]`) as breathing pauses (no more than 1–2 per card), 5-state task lifecycle (`[x]`, `[~]`, `[?]`, `[-]`, `[ ]`), and balanced diagram dimensions.
- **Branching Strategies**: The 3–5 primary pillar golden ratio, narrative spine navigation, specialized leaf divergence, and purposeful cross-branch relations (`dependency`, `reference`, `custom`).
- **Scale Mastery**: The three-tier scale formula (Strategic Anchor 1.15–1.25, Tactical Pillars & Accents 1.05–1.15, Standard Nodes 0.95–1.02, Auxiliary Modules 0.80–0.90), cascading branch scale fields, and negative space via collapsed summary capsules.

## Layouts

| View          | Description                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------- |
| Time tree     | The default layout follows branches and permits up to seven days of positional flexibility. |
| Date priority | Arranges dated nodes in chronological bands while separating branches.                      |

Both views support horizontal and vertical layouts. Undated parent nodes are positioned using their dated descendants.

## Features

- Create, move, copy, cut, paste and collapse branches, including across project tabs.
- Real-time Markdown live editing & preview with CodeMirror 6, formatting shortcuts, Callouts and 5-state tasks (`[ ]`, `[x]`, `[-]`, `[~]`, `[?]`).
- Self-contained image embedding with SHA-256 deduplication, automatic Worker compression (1 MiB / 2048 px threshold) and drag-to-resize relative width (`{width=X%}`).
- Edit node dates, Markdown notes, tags, tasks, sizes and connections, with auto-save on blur and 5-second draft backup.
- Browse tasks by branch and locate nodes using the date directory.
- Switch between 2D and 3D, highlight paths and export SVG.
- Import and export .branch.json files. Ctrl+S or ⌘S downloads the current project.
- Store project snapshots locally in the browser using IndexedDB.

## Quick start

Visit the [live demo](https://panwanke.github.io/workspacetree/) or run locally with Node.js 22.12 or newer and pnpm 10.33.0:

    corepack enable
    pnpm install --frozen-lockfile
    pnpm dev

Open the local URL printed by Vite. Use **Project → Import .branch.json** or drag a file into the application. Use **Project → Export .branch.json** or Ctrl+S to download a snapshot.

## Development

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm --filter @workspacetree/web build

See the [change index](CHANGELOG.md).

## Technology

React, TypeScript, Vite, React Flow, Three.js, Zod, pnpm workspaces and IndexedDB.

## License

No open-source license has been specified for this repository.
