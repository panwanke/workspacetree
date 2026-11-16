import '@xyflow/react/dist/style.css';
import './styles.css';
import './workspace.css';
import './todos.css';
import './tags.css';
import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

export function mountWorkspace(workspace: ReactElement) {
  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root mount point');
  createRoot(container).render(<StrictMode>{workspace}</StrictMode>);
}
