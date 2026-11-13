const paths = {
  tree: 'M12 7v4m-6 6v-4h12v4M9 2h6v5H9zM3 17h6v5H3zM15 17h6v5h-6z',
  chevron: 'm6 9 6 6 6-6',
  folder: 'M3 6h7l2 2h9v12H3z',
  plus: 'M12 5v14M5 12h14',
  undo: 'm9 5-5 5 5 5M4 10h10a5 5 0 0 1 0 10h-1',
  redo: 'm15 5 5 5-5 5m5-5H10a5 5 0 0 0 0 10h1',
  fit: 'M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4m1-8h6m-3-3v6',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  route: 'M6 17V7a3 3 0 1 1 3 3h6a3 3 0 1 1 3 3v4M3 17h6v4H3zm12 0h6v4h-6z',
  sliders: 'M4 7h7m4 0h5M4 17h5m4 0h7M11 4v6m2 4v6',
  panel: 'M15 4v16M3 4h18v16H3z',
  close: 'm6 6 12 12M18 6 6 18',
  trash: 'M4 6h16M9 6V3h6v3m3 0-1 15H7L6 6m4 4v7m4-7v7',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  download: 'M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6',
  reset: 'M4 10a8 8 0 1 1 2 8M4 4v6h6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  pencil: 'm14 5 5 5M4 20l5-1L21 7l-4-4L5 15l-1 5Z',
  help: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM9 9a3 3 0 1 1 4 2.8c-1 .5-1 1.2-1 2.2m0 3h.01',
  tag: 'M3 4h8l10 10-7 7L4 11V4zm4 4h.01',
} as const;

export type WorkspaceIconName = keyof typeof paths;

export function WorkspaceIcon({ name, size = 17 }: { name: WorkspaceIconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
