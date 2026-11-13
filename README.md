# WorkspaceTree

> [中文版](README_zh.md) | [Live demo](https://panwanke.github.io/workspacetree/)

WorkspaceTree is a browser-based canvas for organizing projects as trees of dated nodes. Explore timelines, edit branches and collect tasks in one workspace.

**Prototype:** This project is in active development and is not intended for production project data. Keep separate backups of anything you experiment with.

## Layouts

| View          | Description                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------- |
| Time tree     | The default layout follows branches and permits up to seven days of positional flexibility. |
| Date priority | Arranges dated nodes in chronological bands while separating branches.                      |

Both views support horizontal and vertical layouts. Undated parent nodes are positioned using their dated descendants.

## Features

- Create, move, copy, cut, paste and collapse branches, including across project tabs.
- Edit node dates, Markdown notes, tags, tasks, sizes and connections.
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
