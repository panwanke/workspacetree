import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  ViewportPortal,
  applyNodeChanges,
  useReactFlow,
  useStore,
  Position,
  type NodeChange,
  type Edge as FlowEdge,
  type Connection,
  type FitViewOptions,
} from '@xyflow/react';
import { makeId, newNodeId } from '@workspacetree/core';
import {
  buildHierarchy,
  DEFAULT_VISIBLE_EDGE_TYPES,
  hiddenRelationCount,
  pathToRoot,
  relationCounts,
  multiSpineHighlight,
  resolveLayoutDirection,
  resolveVisualGraph,
  visualEdgeAnchors,
  type LayoutDirection,
  type LayoutStrategy,
  type MultiSpineHighlight,
  type ResolvedEdgeStyle,
  type VisibleEdgeTypes,
  type VisualGraph,
  type VisualEdge,
} from '@workspacetree/layout';
import { exportSvg } from '@workspacetree/export';
import { localToday, readMarkdownBlocks, selectNodeNote } from '@workspacetree/markdown';
import {
  DEFAULT_SCALE_SETTINGS,
  type AssetRecord,
  type BranchFile,
  type Edge,
  type EdgeStyle,
  type HierarchyEdgeRole,
} from '@workspacetree/schema';
import { createBrowserStorageAdapter } from '@workspacetree/storage';
import type { ProjectStorePort } from './project-store';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react';
import CanvasNode, { type CardNode } from './CanvasNode';
import ConnectionDialog, { type ConnectionRequest } from './ConnectionDialog';
import EdgeStyleBatchDialog from './EdgeStyleBatchDialog';
import { useCanvasNodeDrag } from './useCanvasNodeDrag';
import DateDirectory from './DateDirectory';
import RelationEdge from './RelationEdge';
import TimelineAxis from './TimelineAxis';
import WorkspaceInspector, { type ScaleKind } from './WorkspaceInspector';
import WorkspaceTodos from './WorkspaceTodos';
import {
  deleteTodoEntry,
  saveTodoEntry,
  updateTodoEntry,
  type TodoDraft,
  type TodoSource,
} from './todo-editing';
import WorkspaceToolbar, {
  WorkspacePopover,
  type ProjectView,
  type ResizeMode,
  type ViewMode,
} from './WorkspaceToolbar';
import { createDemoBranchFile, createEmptyBranchFile } from './demo';
import { EditorController, type EditorSnapshot } from './editor';
import { branchSnapshotHash, openBranchFile } from './open-branch-file';
import {
  connectLocalProjectFile,
  getDroppedProjectFile,
  localFileSyncMessage,
  pickLocalProjectFile,
  requestLocalProjectPermission,
  restoreLocalProjectFile,
  supportsLocalFileSync,
  type LinkedProjectTab,
  type LocalFileHandle,
} from './local-file-access';
import { useLocalFileSync } from './use-local-file-sync';
import { reparentBranchEntry, restoreBranchLayoutEntry, transferBranch } from './branch-editing';
import { orientConnection, saveRelationEntry, setEdgeNoteEntry } from './edge-editing';
import { isEventMatchingKeybinding, loadKeybindings, type KeybindingAction } from './keybindings';
import { loadSettings, type WorkspaceSettings } from './settings';
import { useMarkdownCss } from './markdown/custom-css';
import SettingsModal from './SettingsModal';
import { NodeEditorOverlay } from './NodeEditorOverlay';
import ProjectsModal from './ProjectsModal';
import SaveProjectModal from './SaveProjectModal';
import SearchModal from './SearchModal';
import { WorkspaceIcon } from './WorkspaceIcon';
import {
  loadWorkspaceSession,
  saveWorkspaceSession,
  scopedSessionKey,
  type StorageScope,
} from './workspace-session';
import {
  clearPositionEntry,
  clearPositionsEntry,
  createNodeEntry,
  createSpineEntry,
  removeSpineEntry,
  renameSpineEntry,
  deleteSubtreeEntry,
  getNodeNote,
  removeEdgeEntry,
  renameNodeEntry,
  renameProjectEntry,
  replaceDomainEntry,
  replacePresentationEntry,
  scaledCustomSize,
  setBranchScaleEntry,
  setBranchVisualScaleEntry,
  setNodeVisualScaleEntry,
  setScaleSettingsEntry,
  setCollapsedEntry,
  setCollapsedNodesEntry,
  setEdgeStyleEntry,
  setEdgeStylesEntry,
  setLayoutDirectionEntry,
  setNodeNoteEntry,
  setNodeScaleEntry,
  setNodeSizeEntry,
} from './history';

const ThreeCanvas = lazy(() => import('./ThreeCanvas'));
const nodeTypes = { card: CanvasNode };
const edgeTypes = { relation: RelationEdge };
const ALL_EDGE_TYPES: VisibleEdgeTypes = ['hierarchy', 'dependency', 'reference', 'custom'];
const COMPACT_WORKSPACE =
  '(max-width: 880px), (hover: none) and (pointer: coarse) and (max-height: 540px)';
const FIT_PADDING: Record<LayoutDirection, FitViewOptions['padding']> = {
  vertical: { top: '6%', bottom: '6%', left: '88px', right: '5%' },
  horizontal: { top: '48px', bottom: '6%', left: '6%', right: '6%' },
};

function download(filename: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface FlowViewportAPI {
  fitView: (options?: FitViewOptions) => Promise<boolean>;
  getViewport: () => { x: number; y: number; zoom: number };
  screenToFlowPosition: (client: { x: number; y: number }) => { x: number; y: number };
}

function FlowViewportController({
  fitTrigger,
  focusNodeId,
  editingNodeId,
  projectKey,
  compact,
  rootId,
  onFocused,
  direction,
  apiRef,
}: {
  fitTrigger: number;
  focusNodeId: string | null;
  editingNodeId: string | null;
  projectKey: string | null;
  compact: boolean;
  rootId: string;
  onFocused: () => void;
  direction: LayoutDirection;
  apiRef?: React.MutableRefObject<FlowViewportAPI | null>;
}) {
  const reactFlow = useReactFlow();
  const editorViewport = useStore((state) => {
    if (!editingNodeId) return null;
    const node = state.nodeLookup.get(editingNodeId);
    if (!node?.data.isEditing || !state.width || !state.height) return null;
    const { width, height } = node.measured;
    if (!width || !height) return null;
    const { x, y } = node.internals.positionAbsolute;
    const [tx, ty, zoom] = state.transform;
    const left = x * zoom + tx;
    const top = y * zoom + ty;
    const fits =
      zoom >= 0.8 &&
      left >= 12 &&
      top >= 12 &&
      left + width * zoom <= state.width - 12 &&
      top + height * zoom <= state.height - 12;
    return fits ? 'visible' : 'clipped';
  });
  const lastFittedEditor = useRef<string | null>(null);
  const lastFittedProject = useRef<string | null>(null);

  useEffect(() => {
    if (apiRef) {
      apiRef.current = {
        fitView: reactFlow.fitView,
        getViewport: reactFlow.getViewport,
        screenToFlowPosition: reactFlow.screenToFlowPosition,
      };
    }
  }, [reactFlow, apiRef]);

  useEffect(() => {
    if (fitTrigger === 0) return;
    const timer = window.setTimeout(() => {
      const firstFit = lastFittedProject.current !== projectKey;
      lastFittedProject.current = projectKey;
      void reactFlow.fitView(
        firstFit && compact
          ? { nodes: [{ id: rootId }], padding: 0.24, maxZoom: 1, duration: 180 }
          : { padding: compact ? 0.18 : FIT_PADDING[direction], duration: 280 },
      );
    }, 30);
    return () => window.clearTimeout(timer);
  }, [fitTrigger, reactFlow, direction, compact, projectKey, rootId]);

  useEffect(() => {
    if (!focusNodeId) return;
    void reactFlow.fitView({
      nodes: [{ id: focusNodeId }],
      padding: compact ? 0.24 : 0.85,
      maxZoom: compact ? 1.25 : undefined,
      duration: 300,
    });
    const timer = window.setTimeout(() => onFocused(), 30);
    return () => window.clearTimeout(timer);
  }, [focusNodeId, reactFlow, onFocused, compact]);

  useEffect(() => {
    if (!editingNodeId) {
      lastFittedEditor.current = null;
      return;
    }
    if (!editorViewport || lastFittedEditor.current === editingNodeId) return;
    lastFittedEditor.current = editingNodeId;
    if (editorViewport === 'visible') return;
    void reactFlow.fitView({
      nodes: [{ id: editingNodeId }],
      padding: compact
        ? { top: '10px', right: '12px', bottom: '10px', left: '12px' }
        : { top: '48px', right: '24px', bottom: '32px', left: '44px' },
      maxZoom: 1.15,
      duration: 160,
    });
  }, [editingNodeId, editorViewport, reactFlow, compact]);

  return null;
}

interface ContextMenuState {
  x: number;
  y: number;
  kind: 'pane' | 'node' | 'edge';
  targetId?: string;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  projectId: string;
  branchName: string;
  controller: EditorController;
  localFile?: LinkedProjectTab;
}

interface WorkspaceAppProps {
  initializeWorkspace?: () => Promise<{ scope: StorageScope; storage: ProjectStorePort }>;
  accountControl?: ReactNode;
  accountDialog?: ReactNode;
  accountNotice?: string | null;
  enableLocalFileSync?: boolean;
}

async function initializeLocalWorkspace() {
  return { scope: 'local' as const, storage: await createBrowserStorageAdapter() };
}

export default function App({
  initializeWorkspace = initializeLocalWorkspace,
  accountControl,
  accountDialog,
  accountNotice,
  enableLocalFileSync = false,
}: WorkspaceAppProps) {
  const canLinkFiles = enableLocalFileSync && supportsLocalFileSync();
  const storageRef = useRef<ProjectStorePort | null>(null);
  const [storageScope, setStorageScope] = useState<StorageScope>('local');
  const flowApiRef = useRef<FlowViewportAPI | null>(null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const tabsRef = useRef(tabs);
  const openQueue = useRef<Promise<void>>(Promise.resolve());
  const fileDragDepth = useRef(0);
  const [fileDragOver, setFileDragOver] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [controller, setController] = useState<EditorController | null>(null);
  const [snapshot, setSnapshot] = useState<EditorSnapshot | null>(null);
  const [nodes, setNodes] = useState<CardNode[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [focusEdgeId, setFocusEdgeId] = useState<string | null>(null);
  const [edgeStyleClipboard, setEdgeStyleClipboard] = useState<ResolvedEdgeStyle | null>(null);
  const [edgeBatchOpen, setEdgeBatchOpen] = useState(false);
  const [edgeDraftDirty, setEdgeDraftDirty] = useState(false);
  const [connectionRequest, setConnectionRequest] = useState<ConnectionRequest | null>(null);
  const [pendingReconnect, setPendingReconnect] = useState<{
    edge: Edge;
    end: 'source' | 'target';
  } | null>(null);
  const draggingEdge = useRef<Edge | null>(null);
  // 记录连线真实起点节点，用于校正 Loose 模式下重叠 handle 造成的方向反转。
  const connectStartNodeId = useRef<string | null>(null);
  const [branchClipboard, setBranchClipboard] = useState<{
    id: string;
    source: EditorController;
    copy: BranchFile | null;
  } | null>(null);
  const cutBranchId =
    branchClipboard && !branchClipboard.copy && branchClipboard.source === controller
      ? branchClipboard.id
      : null;
  const [editingEdge, setEditingEdge] = useState<{
    id: string;
    note: string;
    x: number;
    y: number;
  } | null>(null);
  const selectedNodeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  const setSelectedNodeId = useCallback((id: string | null) => {
    setSelectedNodeIds((previous) =>
      previous.length === (id ? 1 : 0) && (!id || previous[0] === id) ? previous : id ? [id] : [],
    );
  }, []);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusNodeId(null), []);
  const [fitTrigger, setFitTrigger] = useState(1);
  const [layoutStrategy, setLayoutStrategy] = useState<LayoutStrategy>('date-constrained');
  const [scalePreview, setScalePreview] = useState<{
    controller: EditorController;
    id: string;
    kind: ScaleKind;
    value: number;
  } | null>(null);
  const [resizeMode, setResizeMode] = useState<ResizeMode>('box');
  const [showRelations, setShowRelations] = useState(false);
  const [projectView, setProjectView] = useState<ProjectView>('canvas');
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [highlightSpineIds, setHighlightSpineIds] = useState<string[]>([]);
  const [compactWorkspace, setCompactWorkspace] = useState(
    () => window.matchMedia(COMPACT_WORKSPACE).matches,
  );
  const [inspectorOverride, setInspectorOverride] = useState<boolean | null>(null);
  const [desktopDirectoryOpen, setDesktopDirectoryOpen] = useState(() => {
    try {
      return localStorage.getItem('wst_date_directory_open') !== 'false';
    } catch {
      return true;
    }
  });
  const [mobilePanel, setMobilePanel] = useState<'directory' | 'inspector' | null>(null);
  const inspectorOpen = compactWorkspace
    ? mobilePanel === 'inspector'
    : (inspectorOverride ?? true);
  const directoryOpen = compactWorkspace ? mobilePanel === 'directory' : desktopDirectoryOpen;
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const directoryToggleRef = useRef<HTMLButtonElement>(null);
  const [svgMeta, setSvgMeta] = useState('尚未导出');
  const [uiError, setUiError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [keybindings, setKeybindings] = useState<Record<KeybindingAction, string>>(() =>
    loadKeybindings(),
  );
  const [settings, setSettings] = useState<WorkspaceSettings>(() => loadSettings());
  useMarkdownCss(settings.markdownCss);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabTitle, setEditingTabTitle] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const booted = useRef(false);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    if (!booted.current || tabs.length === 0) return;
    saveWorkspaceSession(
      {
        tabs: tabs.map((t) => ({
          id: t.id,
          projectId: t.projectId,
          title: t.title,
          branchName: t.branchName,
          readOnly: t.controller.isReadOnly,
          linkedFile: Boolean(t.localFile) || undefined,
        })),
        activeTabId,
      },
      scopedSessionKey(storageScope),
    );
  }, [tabs, activeTabId, storageScope]);

  useEffect(() => {
    if (selectedNodeIds.length > 0) {
      setSelectedEdgeId(null);
      setFocusEdgeId(null);
      setEditingEdge(null);
    }
  }, [selectedNodeIds]);

  useEffect(() => {
    setScalePreview(null);
  }, [selectedNodeId, inspectorOpen, projectView]);

  useEffect(() => {
    try {
      localStorage.setItem('wst_date_directory_open', String(desktopDirectoryOpen));
    } catch {}
  }, [desktopDirectoryOpen]);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_WORKSPACE);
    const update = (event: MediaQueryListEvent) => {
      setCompactWorkspace(event.matches);
      setMobilePanel(null);
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const closeMobilePanel = useCallback(() => {
    if (!mobilePanel) return;
    setMobilePanel(null);
    const trigger = mobilePanel === 'directory' ? directoryToggleRef : inspectorToggleRef;
    trigger.current?.focus({ preventScroll: true });
  }, [mobilePanel]);

  useEffect(() => {
    if (!compactWorkspace || !mobilePanel) return;
    const panelId = mobilePanel === 'directory' ? 'workspace-directory' : 'workspace-inspector';
    document.getElementById(panelId)?.querySelector('button')?.focus({ preventScroll: true });
  }, [compactWorkspace, mobilePanel]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const { scope, storage } = await initializeWorkspace();
        setStorageScope(scope);
        storageRef.current = storage;

        const session = loadWorkspaceSession(scopedSessionKey(scope));
        let loadedTabs: WorkspaceTab[] = [];

        // 清理旧版本演示项目（只对本地空间执行，云端没有这些历史 id）
        if (scope === 'local') {
          try {
            await storage.clear('prj_thesis_demo_v3');
            await storage.clear('prj_thesis_demo');
          } catch (e) {
            console.warn('Failed to clean legacy demo projects:', e);
          }
        }

        const validSessionTabs = (session?.tabs || []).filter(
          (st) => st.projectId !== 'prj_thesis_demo_v3' && st.projectId !== 'prj_thesis_demo',
        );

        if (validSessionTabs.length > 0) {
          for (const st of validSessionTabs) {
            try {
              if (st.linkedFile && !enableLocalFileSync) continue;
              const localFile = st.linkedFile
                ? await restoreLocalProjectFile(st.id, st.projectId).catch(
                    (cause: unknown): LinkedProjectTab => ({ issue: localFileSyncMessage(cause) }),
                  )
                : undefined;
              const file = localFile
                ? (localFile.file ?? createEmptyBranchFile(st.title, st.branchName))
                : await storage.load(st.projectId);
              if (file) {
                const controller = (localFile ? !localFile.storage : st.readOnly)
                  ? EditorController.preview(file)
                  : new EditorController(localFile?.storage ?? storage, file);
                loadedTabs.push({
                  id: st.id,
                  title: file.domain.project.title || st.title,
                  projectId: st.projectId,
                  branchName: file.activeBranch,
                  controller,
                  localFile,
                });
              }
            } catch (err) {
              console.warn(`Failed to restore tab for project ${st.projectId}:`, err);
            }
          }
        }

        if (loadedTabs.length === 0) {
          const editor = await EditorController.bootstrap(
            storage,
            scope === 'account'
              ? () => createEmptyBranchFile('我的项目', 'main')
              : createDemoBranchFile,
          );
          const demoTab: WorkspaceTab = {
            id: makeId('tab_'),
            title: editor.getSnapshot().file.domain.project.title || '演示项目',
            projectId: editor.getSnapshot().file.projectId,
            branchName: editor.getSnapshot().file.activeBranch,
            controller: editor,
          };
          loadedTabs = [demoTab];
        }

        const activeId =
          session?.activeTabId && loadedTabs.some((t) => t.id === session.activeTabId)
            ? session.activeTabId
            : loadedTabs[0].id;

        tabsRef.current = loadedTabs;
        setTabs(loadedTabs);
        setActiveTabId(activeId);
        const activeTabItem = loadedTabs.find((t) => t.id === activeId) ?? loadedTabs[0];
        setController(activeTabItem.controller);
        setSnapshot(activeTabItem.controller.getSnapshot());
      } catch (cause) {
        setBootError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [enableLocalFileSync, initializeWorkspace]);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const tabController = activeTab?.controller;
  const localFileIssue = useLocalFileSync(
    tabController,
    activeTab?.localFile?.storage,
    Boolean(editingNodeId || editingEdge || editingTabId || connectionRequest || edgeDraftDirty),
  );

  useEffect(() => {
    if (!tabController) return;
    setController(tabController);
    setSnapshot(tabController.getSnapshot());
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setFocusEdgeId(null);
    setConnectionRequest(null);
    setPendingReconnect(null);
    setEditingEdge(null);
    setContextMenu(null);
    setEditingNodeId(null);
    setMobilePanel(null);
    setFocusNodeId(null);
    setScalePreview(null);
    setHighlightSpineIds([]);
    setFitTrigger((value) => value + 1);
  }, [tabController]);

  useEffect(() => {
    if (!controller) return;
    return controller.subscribe(() => {
      const latest = controller.getSnapshot();
      setSnapshot(latest);
      setTabs((prev) =>
        prev.map((t) =>
          t.controller === controller
            ? {
                ...t,
                title: latest.file.domain.project.title || '未命名分支',
                branchName: latest.file.activeBranch,
              }
            : t,
        ),
      );
    });
  }, [controller]);

  const canvasRef = useRef<HTMLElement>(null);
  const file: BranchFile | null = snapshot?.file ?? null;
  const missingFileSnapshot = Boolean(activeTab?.localFile && !activeTab.localFile.file);
  const readOnly = controller?.isReadOnly ?? false;
  const layoutDirection = file ? resolveLayoutDirection(file.presentation) : 'vertical';
  const getCanvasZoom = useCallback(() => flowApiRef.current?.getViewport().zoom ?? 1, []);
  const { guides, ...nodeDragHandlers } = useCanvasNodeDrag({
    editor: controller,
    direction: layoutDirection,
    strategy: layoutStrategy,
    enabled: projectView === 'canvas' && viewMode === '2d' && !readOnly,
    nodes,
    setNodes,
    getZoom: getCanvasZoom,
  });
  const visibleTypes = showRelations ? ALL_EDGE_TYPES : DEFAULT_VISIBLE_EDGE_TYPES;
  const visualGraph = useMemo(() => {
    if (!file) return null;
    const expanded = snapshot?.previewExpandedNodeIds ?? [];
    const presentation = { ...file.presentation };
    if (expanded.length) {
      presentation.collapsedByDefault = presentation.collapsedByDefault.filter(
        (id) => !expanded.includes(id),
      );
    }
    if (
      scalePreview &&
      scalePreview.controller === controller &&
      scalePreview.id === selectedNodeId &&
      projectView === 'canvas' &&
      inspectorOpen
    ) {
      const { id, kind, value } = scalePreview;
      if (kind === 'node') {
        const size = scaledCustomSize(presentation, id, value);
        if (size) presentation.nodeSizes = { ...presentation.nodeSizes, [id]: size };
        presentation.nodeScales = { ...presentation.nodeScales, [id]: value };
      } else if (kind === 'node-visual') {
        presentation.nodeVisualScales = { ...presentation.nodeVisualScales, [id]: value };
      } else if (kind === 'branch-visual') {
        presentation.branchVisualScales = { ...presentation.branchVisualScales, [id]: value };
      } else {
        presentation.branchScales = { ...presentation.branchScales, [id]: value };
      }
    }
    return resolveVisualGraph(file.domain, presentation, { strategy: layoutStrategy });
  }, [
    file,
    layoutStrategy,
    snapshot?.previewExpandedNodeIds,
    controller,
    scalePreview,
    selectedNodeId,
    projectView,
    inspectorOpen,
  ]);

  const guard = useCallback(
    (action: () => void | Promise<void>): void => {
      if (!controller || !file) return;
      setUiError(null);
      void Promise.resolve()
        .then(action)
        .then(() => {
          const latest = controller.getSnapshot();
          if (latest.error) setUiError(latest.error);
        })
        .catch((cause: unknown) =>
          setUiError(cause instanceof Error ? cause.message : String(cause)),
        );
    },
    [controller, file],
  );

  const updateTodo = useCallback(
    (source: TodoSource, changes: Partial<TodoDraft>) => {
      const day = localToday();
      setUiError(null);
      return controller!.runFromLatest((latest) => updateTodoEntry(latest, source, changes, day));
    },
    [controller],
  );

  const toggleTodo = useCallback(
    (source: TodoSource, checked: boolean) => {
      guard(() => updateTodo(source, { status: checked ? 'done' : 'open' }));
    },
    [guard, updateTodo],
  );

  const handleStartEdit = useCallback(
    (id: string) => {
      if (readOnly) return;
      setSelectedNodeIds([id]);
      setEditingNodeId(id);
    },
    [readOnly],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingNodeId(null);
  }, []);

  const persistNodeDraft = useCallback(
    async (
      id: string,
      title: string,
      markdown: string,
      baseNote: string,
      assets?: Record<string, AssetRecord>,
    ) => {
      if (!controller) return false;
      setUiError(null);
      try {
        await controller.runFromLatest(({ domain }) => {
          const node = domain.nodes.find((item) => item.id === id);
          if (!node) throw new Error('原节点已不存在。');
          const current = getNodeNote(domain, id);
          const hasAssets = Object.keys(assets ?? {}).length > 0;
          const edited = markdown !== baseNote || hasAssets;
          if (edited && current !== baseNote && current !== markdown) {
            throw new Error('笔记已变化，编辑内容仍在草稿中。');
          }
          const rename =
            title && title !== node.title ? renameNodeEntry(domain, id, title) : undefined;
          const note =
            edited && (markdown !== current || hasAssets)
              ? setNodeNoteEntry(domain, id, markdown, assets)
              : undefined;
          if (!rename || !note) return rename ?? note;
          return {
            ...note,
            forward: [...rename.forward, ...note.forward],
            inverse: [...note.inverse, ...rename.inverse],
          };
        });
        return true;
      } catch (cause) {
        setUiError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [controller],
  );

  const finishNodeEdit = useCallback((id: string) => {
    setEditingNodeId((editingId) => (editingId === id ? null : editingId));
  }, []);

  const handleRenameProject = useCallback(
    (newTitle: string) => {
      if (!controller || !file) return;
      const trimmed = newTitle.trim();
      if (!trimmed || trimmed === file.domain.project.title) return;
      guard(async () => {
        await controller.run(renameProjectEntry(file.domain, trimmed));
      });
    },
    [controller, file, guard],
  );

  const handleRenameProjectById = useCallback(
    async (projectId: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      const tab = tabs.find((t) => !t.localFile && t.projectId === projectId);
      if (tab) {
        const snap = tab.controller.getSnapshot();
        if (snap.file.domain.project.title !== trimmed) {
          guard(async () => {
            await tab.controller.run(renameProjectEntry(snap.file.domain, trimmed));
          });
        }
        return;
      }
      const storage = storageRef.current;
      if (storage) {
        const targetFile = await storage.load(projectId);
        if (targetFile && targetFile.domain.project.title !== trimmed) {
          const tempController = new EditorController(storage, targetFile);
          await tempController.run(renameProjectEntry(targetFile.domain, trimmed));
        }
      }
    },
    [tabs, guard],
  );

  const handleStartRenameTab = useCallback((tab: WorkspaceTab) => {
    if (tab.controller.isReadOnly) return;
    setEditingTabId(tab.id);
    setEditingTabTitle(tab.title);
  }, []);

  const handleCommitRenameTab = useCallback(
    (tab: WorkspaceTab) => {
      setEditingTabId(null);
      const trimmed = editingTabTitle.trim();
      if (!trimmed || trimmed === tab.title) return;
      guard(async () => {
        const snap = tab.controller.getSnapshot();
        await tab.controller.run(renameProjectEntry(snap.file.domain, trimmed));
      });
    },
    [editingTabTitle, guard],
  );

  const handleResizeBox = useCallback(
    (id: string, width: number, height: number) => {
      if (!controller || !file) return;
      guard(() => controller.run(setNodeSizeEntry(file, id, { width, height })));
    },
    [controller, file, guard],
  );

  const handleResizeScale = useCallback(
    (
      id: string,
      nextScale: number,
      kind: 'node' | 'branch' | 'node-visual' | 'branch-visual' = 'node',
    ) => {
      if (!controller || !file) return;
      guard(() => {
        let entry: any;
        if (kind === 'branch') {
          entry = setBranchScaleEntry(file, id, nextScale);
        } else if (kind === 'branch-visual') {
          entry = setBranchVisualScaleEntry(file, id, nextScale);
        } else if (kind === 'node-visual') {
          entry = setNodeVisualScaleEntry(file, id, nextScale);
        } else {
          entry = setNodeScaleEntry(file, id, nextScale);
        }
        return controller.run(entry);
      });
    },
    [controller, file, guard],
  );

  function previewInspectorScale(id: string, kind: ScaleKind, value: number | null): void {
    if (!controller || readOnly) return;
    setScalePreview(value === null ? null : { controller, id, kind, value });
  }

  function applyInspectorScale(id: string, kind: ScaleKind, value: number): void {
    if (!controller || readOnly) return;
    guard(async () => {
      try {
        const current = controller.getSnapshot().file;
        let saved: number | undefined;
        let entry: any;
        if (kind === 'branch') {
          saved = current.presentation.branchScales[id];
          entry = setBranchScaleEntry(current, id, value);
        } else if (kind === 'branch-visual') {
          saved = current.presentation.branchVisualScales?.[id];
          entry = setBranchVisualScaleEntry(current, id, value);
        } else if (kind === 'node-visual') {
          saved = current.presentation.nodeVisualScales?.[id];
          entry = setNodeVisualScaleEntry(current, id, value);
        } else {
          saved = current.presentation.nodeScales?.[id];
          entry = setNodeScaleEntry(current, id, value, true);
        }
        if ((saved ?? 1) !== value) {
          await controller.run(entry);
        }
      } finally {
        setScalePreview((latest) =>
          latest?.controller === controller &&
          latest.id === id &&
          latest.kind === kind &&
          latest.value === value
            ? null
            : latest,
        );
      }
    });
  }

  const derived = useMemo(() => {
    if (!file || !visualGraph)
      return {
        flowNodes: [] as CardNode[],
        flowEdges: [] as FlowEdge[],
        counts: {} as Record<string, number>,
        hidden: 0,
        highlight: { nodeIds: [], edgeIds: [], paths: [] } as MultiSpineHighlight,
        graph: null as VisualGraph | null,
      };
    const graph = visualGraph;
    const counts = relationCounts(file.domain.edges, visibleTypes);
    const highlight = multiSpineHighlight(file.domain.spines, file.domain.edges, highlightSpineIds);
    const nodeMap = new Map(file.domain.nodes.map((node) => [node.id, node]));

    const highlighted = new Set(highlight.nodeIds);
    const highlightedEdges = new Set(highlight.edgeIds);

    // 点击节点高亮：当未锁定 Spine 高亮时，自动高亮选中节点的祖先链、直接子节点与关联邻居。
    if (highlighted.size === 0 && selectedNodeIds.length > 0) {
      for (const sid of selectedNodeIds) {
        if (!nodeMap.has(sid)) continue;
        const lineage = pathToRoot(file.domain.nodes, file.domain.edges, sid);
        for (const id of lineage) highlighted.add(id);
        for (let i = 0; i + 1 < lineage.length; i += 1) {
          const edge = file.domain.edges.find(
            (item) =>
              item.type === 'hierarchy' &&
              item.fromNodeId === lineage[i] &&
              item.toNodeId === lineage[i + 1],
          );
          if (edge) highlightedEdges.add(edge.id);
        }
        for (const edge of file.domain.edges) {
          if (edge.fromNodeId === sid || edge.toNodeId === sid) {
            highlighted.add(edge.fromNodeId);
            highlighted.add(edge.toNodeId);
            highlightedEdges.add(edge.id);
          }
        }
      }
    }

    const selectedSet = new Set(selectedNodeIds);
    const locked = new Set(graph.locked);

    const childHierarchyMap = buildHierarchy(file.domain.nodes, file.domain.edges).children;
    const notes = readMarkdownBlocks(file.domain.blocks);

    const flowNodes: CardNode[] = graph.nodes.map((visual) => {
      const node = nodeMap.get(visual.id)!;
      const note = selectNodeNote(node, notes);
      const hasChildren = (childHierarchyMap.get(visual.id) ?? []).length > 0 || visual.collapsed;
      const isEditing = editingNodeId === visual.id;
      const width = visual.size.width;
      const height = visual.size.height;
      return {
        id: visual.id,
        type: 'card',
        position: visual.position,
        style: {
          width,
          height,
          zIndex: isEditing ? 100 : undefined,
        },
        sourcePosition: graph.direction === 'horizontal' ? Position.Right : Position.Bottom,
        targetPosition: graph.direction === 'horizontal' ? Position.Left : Position.Top,
        data: {
          title: node.title,
          note: note?.markdown,
          tags: node.tags,
          taskTotal: visual.taskTotal,
          taskDone: visual.taskDone,
          relationCount: counts[node.id] ?? 0,
          highlighted: highlighted.has(node.id),
          dimmed: highlighted.size > 0 && !highlighted.has(node.id),
          archived: node.archived,
          direction: graph.direction,
          scale: visual.scale,
          effectiveLayoutScale: visual.effectiveLayoutScale,
          effectiveVisualScale: visual.effectiveVisualScale,
          layoutScale: visual.layoutScale,
          visualScale: visual.visualScale,
          branchLayoutScale: visual.branchLayoutScale,
          branchVisualScale: visual.branchVisualScale,
          layoutSize: visual.layoutSize,
          visualSize: visual.visualSize,
          startAt: visual.startAt,
          locked: locked.has(node.id),
          collapsed: visual.collapsed,
          collapsedCount: visual.collapsedCount,
          externalConnectionCount: visual.externalConnectionCount,
          lod: visual.lod,
          accentColor: visual.branchColor ?? '#475569',
          assets: file.domain.assets,
          isEditing: editingNodeId === node.id,
          readOnly,
          isCut: cutBranchId === node.id,
          resizeMode,
          dragResizeBindings: {
            resizeProportional: keybindings.resizeProportional,
            resizeBranch: keybindings.resizeBranch,
            resizeNodeScale: keybindings.resizeNodeScale,
          },
          hasChildren,
          onToggleCollapse: (targetId: string) => {
            if (!controller || readOnly) return;
            guard(() =>
              controller.run(
                setCollapsedEntry(
                  file,
                  targetId,
                  !file.presentation.collapsedByDefault.includes(targetId),
                ),
              ),
            );
          },
          onStartEdit: handleStartEdit,
          onSaveDraft: persistNodeDraft,
          onFinishEdit: finishNodeEdit,
          onCancelEdit: handleCancelEdit,
          onToggleTodo:
            !readOnly && note
              ? (lineIndex: number, checked: boolean) => {
                  toggleTodo(
                    {
                      source: 'markdown',
                      nodeId: node.id,
                      blockId: note.id,
                      lineIndex,
                      markdown: note.markdown,
                    },
                    checked,
                  );
                }
              : undefined,
          onResizeBox: handleResizeBox,
          onResizeScale: handleResizeScale,
          autoSaveEnabled: settings.autoSaveNode,
          autoSaveInterval: settings.autoSaveInterval,
        },
        selected: selectedSet.has(node.id),
      } satisfies CardNode;
    });
    const visible = new Set(visibleTypes);
    const hasHighlight = highlighted.size > 0;
    const originalEdges = new Map(file.domain.edges.map((edge) => [edge.id, edge]));
    const flowEdges: FlowEdge[] = graph.edges
      .filter((edge) => visible.has(edge.type))
      .map((edge) => {
        const isHighlighted = edge.originalEdgeIds.some((id) => highlightedEdges.has(id));
        const selected = selectedEdgeId === edge.id;
        const original =
          edge.originalEdgeIds.length === 1
            ? originalEdges.get(edge.originalEdgeIds[0])
            : undefined;
        const direct =
          edge.direct &&
          Boolean(
            original &&
            original.fromNodeId === edge.sourceId &&
            original.toNodeId === edge.targetId,
          );
        const style = edge.style2d;
        const markerColor = selected ? '#2563eb' : isHighlighted ? '#ea580c' : style.color;
        const marker = {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: markerColor,
          orient: 'auto-start-reverse' as const,
        };
        const hasStartArrow = style.arrow === 'start' || style.arrow === 'both';
        const hasEndArrow = style.arrow === 'end' || style.arrow === 'both';
        const anchors = visualEdgeAnchors(
          graph.nodeById[edge.sourceId],
          graph.nodeById[edge.targetId],
          graph.direction,
        );
        return {
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          sourceHandle: `source-${anchors.sourceSide}`,
          targetHandle: `target-${anchors.targetSide}`,
          type: 'relation',
          selected,
          reconnectable:
            Boolean(!readOnly && selected && direct) &&
            (edge.type === 'hierarchy' ? 'source' : true),
          interactionWidth: 20,
          zIndex: selected ? 12 : isHighlighted ? 10 : 0,
          markerStart: hasStartArrow ? marker : undefined,
          markerEnd: hasEndArrow ? marker : undefined,
          data: {
            kind: edge.type,
            highlighted: isHighlighted,
            dimmed: hasHighlight && !isHighlighted,
            color: style.color,
            width: style.width,
            dashArray: style.dashArray,
            aggregatedCount: edge.aggregatedCount,
            note: direct ? original?.note : undefined,
          },
        };
      });
    return {
      flowNodes,
      flowEdges,
      counts,
      hidden: hiddenRelationCount(file.domain.edges, visibleTypes),
      highlight,
      graph,
    };
  }, [
    file,
    visualGraph,
    visibleTypes,
    highlightSpineIds,
    selectedNodeIds,
    editingNodeId,
    compactWorkspace,
    selectedEdgeId,
    cutBranchId,
    readOnly,
    resizeMode,
    handleStartEdit,
    finishNodeEdit,
    persistNodeDraft,
    toggleTodo,
    handleCancelEdit,
    handleResizeBox,
    handleResizeScale,
    keybindings,
    settings.autoSaveNode,
    settings.autoSaveInterval,
    controller,
    guard,
  ]);

  const highlightNodeKey = derived.highlight.nodeIds.join('|');
  const highlightEdgeKey = derived.highlight.edgeIds.join('|');

  useEffect(() => {
    setNodes((previous) => {
      const byId = new Map(previous.map((node) => [node.id, node]));
      return derived.flowNodes.map((node) => {
        const prior = byId.get(node.id);
        if (!prior) return node;
        const sameSize =
          prior.style?.width === node.style?.width && prior.style?.height === node.style?.height;
        return {
          ...node,
          measured: sameSize ? prior.measured : undefined,
          ...(prior.dragging ? { position: prior.position, dragging: true } : {}),
        };
      });
    });
  }, [derived.flowNodes]);

  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
    const selection = changes.filter((change) => change.type === 'select');
    if (!selection.length) return;
    setSelectedNodeIds((current) => {
      const next = new Set(current);
      for (const change of selection) {
        if (change.selected) next.add(change.id);
        else next.delete(change.id);
      }
      return [...next];
    });
  }, []);

  const selectedNode = file?.domain.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const visibleNodeIds = useMemo(
    () => new Set(derived.flowNodes.map((node) => node.id)),
    [derived.flowNodes],
  );

  function locateNode(id: string): void {
    setSelectedNodeId(id);
    setFocusNodeId(id);
  }

  function locateProjectNode(id: string, showInspector: boolean): void {
    if (!controller) return;
    guard(async () => {
      const latest = controller.getSnapshot().file;
      const path = pathToRoot(latest.domain.nodes, latest.domain.edges, id);
      const collapsed = new Set(latest.presentation.collapsedByDefault);
      const ancestors = path.slice(0, -1).filter((ancestorId) => collapsed.has(ancestorId));
      if (ancestors.length > 0) {
        if (controller.isReadOnly) controller.expandPreviewAncestors(ancestors);
        else {
          await controller.run(setCollapsedNodesEntry(latest, ancestors, false));
          if (controller.getSnapshot().error) return;
        }
      }
      setEditingNodeId(null);
      if (showInspector) {
        if (compactWorkspace) setMobilePanel('inspector');
        else setInspectorOverride(true);
      }
      setProjectView('canvas');
      locateNode(id);
    });
  }

  const addChildWithInheritedStyle = useCallback(
    (parentId: string, startEditing = false, role?: HierarchyEdgeRole): void => {
      if (!file || !controller) return;
      const id = newNodeId();
      const existingHierarchyEdges = file.domain.edges.filter(
        (edge) => edge.type === 'hierarchy' && edge.fromNodeId === parentId,
      );
      const effectiveRole: HierarchyEdgeRole =
        role ??
        (existingHierarchyEdges.some((edge) => edge.role === 'continuation')
          ? 'leaf'
          : 'continuation');
      const count = file.domain.nodes.length + 1;
      const title = effectiveRole === 'branch' ? `新分支 ${count}` : `新节点 ${count}`;
      guard(async () => {
        await controller.run(
          createNodeEntry(id, title, parentId, makeId('e_'), effectiveRole, file.presentation),
        );
        if (controller.getSnapshot().error) return;
        setSelectedNodeIds([id]);
        if (startEditing) {
          setEditingNodeId(id);
        } else if (compactWorkspace) {
          setFocusNodeId(id);
        }
      });
    },
    [controller, file, guard, compactWorkspace],
  );

  function addNode(): void {
    if (!file) return;
    const parentId = selectedNodeId ?? file.domain.project.rootNodeId;
    addChildWithInheritedStyle(parentId, false);
  }

  function addBranch(): void {
    if (!file) return;
    const parentId = selectedNodeId ?? file.domain.project.rootNodeId;
    addChildWithInheritedStyle(parentId, false, 'branch');
  }

  const addIndependentNode = useCallback(
    (screenPos?: { x: number; y: number }): void => {
      if (!file || !controller || readOnly) return;
      const bounds = canvasRef.current?.getBoundingClientRect();
      const point =
        screenPos ??
        (bounds && { x: bounds.left + bounds.width * 0.4, y: bounds.top + bounds.height * 0.4 });
      const initialPos = point && flowApiRef.current?.screenToFlowPosition(point);

      const id = newNodeId();
      const count = file.domain.nodes.length + 1;
      guard(async () => {
        await controller.run(
          createNodeEntry(
            id,
            `独立节点 ${count}`,
            null,
            makeId('e_'),
            file.presentation,
            initialPos,
            layoutDirection,
          ),
        );
        if (controller.getSnapshot().error) return;
        setSelectedNodeIds([id]);
        handleStartEdit(id);
      });
    },
    [controller, file, guard, handleStartEdit, layoutDirection, readOnly],
  );

  const handleNewTab = useCallback(async () => {
    if (!storageRef.current) return;
    const count = tabs.length + 1;
    const newFile = createEmptyBranchFile(`分支项目 ${count}`, `branch-${count}`);
    const newEditor = new EditorController(storageRef.current, newFile);
    await storageRef.current.createIfAbsent(newFile);
    const newTab: WorkspaceTab = {
      id: makeId('tab_'),
      title: newFile.domain.project.title,
      projectId: newFile.projectId,
      branchName: newFile.activeBranch,
      controller: newEditor,
    };
    tabsRef.current = [...tabsRef.current, newTab];
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, [tabs.length]);

  const handleCloseTab = useCallback(
    (tabId: string, event: React.MouseEvent) => {
      event.stopPropagation();
      const closing = tabsRef.current.find((tab) => tab.id === tabId);
      if (closing && tabsRef.current.length > 1) {
        setBranchClipboard((current) =>
          current && !current.copy && current.source === closing.controller ? null : current,
        );
      }
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const nextTabs = prev.filter((t) => t.id !== tabId);
        tabsRef.current = nextTabs;
        if (activeTabId === tabId) {
          const nextActive = nextTabs[nextTabs.length - 1];
          setActiveTabId(nextActive.id);
        }
        return nextTabs;
      });
    },
    [activeTabId],
  );

  const handleOpenProjectById = useCallback(async (projectId: string) => {
    const storage = storageRef.current;
    if (!storage) return;
    const existing = tabsRef.current.find((t) => !t.localFile && t.projectId === projectId);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const file = await storage.load(projectId);
    if (!file) {
      setUiError(`无法加载项目 ${projectId}`);
      return;
    }
    const newTab: WorkspaceTab = {
      id: makeId('tab_'),
      title: file.domain.project.title || '未命名项目',
      projectId: file.projectId,
      branchName: file.activeBranch,
      controller: new EditorController(storage, file),
    };
    tabsRef.current = [...tabsRef.current, newTab];
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      const storage = storageRef.current;
      if (!storage) return;
      await storage.clear(projectId);
      const remainingTabs = tabsRef.current.filter((t) => t.localFile || t.projectId !== projectId);
      if (remainingTabs.length !== tabsRef.current.length) {
        if (remainingTabs.length === 0) {
          const demo = await EditorController.bootstrap(
            storage,
            storageScope === 'account'
              ? () => createEmptyBranchFile('我的项目', 'main')
              : createDemoBranchFile,
          );
          const demoTab: WorkspaceTab = {
            id: makeId('tab_'),
            title: demo.getSnapshot().file.domain.project.title || '演示项目',
            projectId: demo.getSnapshot().file.projectId,
            branchName: demo.getSnapshot().file.activeBranch,
            controller: demo,
          };
          tabsRef.current = [demoTab];
          setTabs([demoTab]);
          setActiveTabId(demoTab.id);
        } else {
          tabsRef.current = remainingTabs;
          setTabs(remainingTabs);
          if (!remainingTabs.some((t) => t.id === activeTabId)) {
            setActiveTabId(remainingTabs[remainingTabs.length - 1].id);
          }
        }
      }
    },
    [activeTabId, storageScope],
  );

  function deleteNode(): void {
    if (!file || !selectedNodeId) return;
    if (selectedNodeId === file.domain.project.rootNodeId) {
      setUiError('根节点不可删除');
      return;
    }
    guard(() => controller!.runFromLatest((latest) => deleteSubtreeEntry(latest, selectedNodeId)));
    setSelectedNodeId(null);
  }

  function createSpine(targetNodeId?: string, customTitle?: string): void {
    if (!file || !controller || readOnly) return;
    const target = targetNodeId ?? selectedNodeId ?? file.domain.project.rootNodeId;
    const nodeIds = pathToRoot(file.domain.nodes, file.domain.edges, target);
    const id = makeId('spn_');
    const title = customTitle ?? `主干 ${file.domain.spines.length + 1}`;
    guard(async () => {
      await controller.run(createSpineEntry(id, title, nodeIds));
      setHighlightSpineIds((current) => (current.includes(id) ? current : [...current, id]));
    });
  }

  function renameSpine(id: string, title: string): void {
    if (!file || !controller || readOnly) return;
    guard(async () => {
      await controller.run(renameSpineEntry(file.domain, id, title));
    });
  }

  function removeSpine(id: string): void {
    if (!file || !controller || readOnly) return;
    guard(async () => {
      await controller.run(removeSpineEntry(file.domain, id));
      setHighlightSpineIds((current) => current.filter((item) => item !== id));
    });
  }

  function exportSvgFile(): void {
    if (!file || missingFileSnapshot) return;
    const result = exportSvg({
      nodes: file.domain.nodes,
      edges: file.domain.edges,
      positions: derived.graph?.positions ?? {},
      graph: derived.graph ?? undefined,
      tasks: file.domain.tasks,
      blocks: file.domain.blocks,
      assets: file.domain.assets,
      visibleEdgeTypes: visibleTypes,
      highlightNodeIds: derived.highlight.nodeIds,
      title: `${file.domain.project.title} · 统一几何画布导出`,
    });
    setSvgMeta(
      `节点 ${result.meta.nodeCount} / 边 ${result.meta.edgeCount} / 类型 [${result.meta.edgeTypes.join(',')}] / ${result.meta.width}×${result.meta.height}`,
    );
    download(`${file.projectId}.svg`, result.svg, 'image/svg+xml');
  }

  function exportJson(): void {
    if (!file || missingFileSnapshot) return;
    setSaveModalOpen(true);
  }

  async function openLinkedFile(
    picked: Promise<LocalFileHandle | undefined>,
    reconnecting?: WorkspaceTab,
  ): Promise<void> {
    try {
      const handle = await picked;
      if (!handle) return;
      await requestLocalProjectPermission(handle);
      openQueue.current = openQueue.current
        .then(async () => {
          let existing = reconnecting;
          if (!existing) {
            for (const tab of tabsRef.current) {
              if (tab.localFile?.handle && (await handle.isSameEntry(tab.localFile.handle))) {
                existing = tab;
                break;
              }
            }
          }
          setUiError(null);
          if (existing?.localFile?.storage && !reconnecting) {
            setActiveTabId(existing.id);
            setProjectView('canvas');
            return;
          }
          const id = existing?.id ?? makeId('tab_');
          const localFile = await connectLocalProjectFile(id, handle, existing?.projectId);
          const file = localFile.file;
          const tab: WorkspaceTab = {
            id,
            title: file.domain.project.title || handle.name,
            projectId: file.projectId,
            branchName: file.activeBranch,
            controller: new EditorController(localFile.storage, file),
            localFile,
          };
          const nextTabs = existing
            ? tabsRef.current.map((entry) => (entry.id === id ? tab : entry))
            : [...tabsRef.current, tab];
          tabsRef.current = nextTabs;
          setTabs(nextTabs);
          setProjectView('canvas');
          setActiveTabId(tab.id);
        })
        .catch((cause: unknown) => setUiError(localFileSyncMessage(cause)));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setUiError(localFileSyncMessage(cause));
    }
  }

  function importProject(): void {
    if (!enableLocalFileSync) {
      importRef.current?.click();
      return;
    }
    if (!canLinkFiles) {
      setUiError('导入并同步需要支持本地文件读写的桌面浏览器，例如 Chrome 或 Edge。');
      return;
    }
    void openLinkedFile(pickLocalProjectFile());
  }

  function resumeLocalFile(tab: WorkspaceTab): void {
    const handle = tab.localFile?.handle;
    if (!handle && !canLinkFiles) {
      importProject();
      return;
    }
    void openLinkedFile(handle ? Promise.resolve(handle) : pickLocalProjectFile(), tab);
  }

  function openFiles(files: readonly File[]): void {
    const storage = storageRef.current;
    if (!storage) return;
    for (const picked of files) {
      openQueue.current = openQueue.current.then(async () => {
        try {
          setUiError(null);
          const opened = await openBranchFile(picked, storage);
          const sameProject = tabsRef.current.filter(
            (tab) => !tab.localFile && tab.projectId === opened.file.projectId,
          );
          const editable = sameProject.find((tab) => !tab.controller.isReadOnly);
          // An external write can advance storage while this editor holds an older snapshot.
          // Keep its in-memory history and show the newly opened snapshot separately.
          const asPreview = opened.readOnly || Boolean(editable);
          const existing =
            sameProject.find(
              (tab) =>
                !tab.controller.isReadOnly &&
                branchSnapshotHash(tab.controller.getSnapshot().file) === opened.snapshotHash,
            ) ??
            (asPreview
              ? sameProject.find(
                  (tab) =>
                    tab.controller.isReadOnly &&
                    branchSnapshotHash(tab.controller.getSnapshot().file) === opened.snapshotHash,
                )
              : undefined);
          if (existing) {
            setActiveTabId(existing.id);
            return;
          }
          const newTab: WorkspaceTab = {
            id: makeId('tab_'),
            title: opened.file.domain.project.title || picked.name.replace(/\.branch\.json$/i, ''),
            projectId: opened.file.projectId,
            branchName: opened.file.activeBranch,
            controller: asPreview
              ? EditorController.preview(opened.file)
              : new EditorController(storage, opened.file),
          };
          tabsRef.current = [...tabsRef.current, newTab];
          setTabs((prev) => [...prev, newTab]);
          setProjectView('canvas');
          setActiveTabId(newTab.id);
        } catch (cause) {
          setUiError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    }
  }

  function importJson(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    openFiles(files);
  }

  function handleFileDrag(event: DragEvent, change: number): void {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    fileDragDepth.current = Math.max(0, fileDragDepth.current + change);
    setFileDragOver(fileDragDepth.current > 0);
  }

  const putBranchOnClipboard = useCallback(
    (id: string, copy = false) => {
      if (!controller || !file || id === file.domain.project.rootNodeId || (!copy && readOnly))
        return;
      setBranchClipboard({ id, source: controller, copy: copy ? file : null });
      setSelectedEdgeId(null);
      setFocusEdgeId(null);
    },
    [controller, file, readOnly],
  );

  const commitBranchMove = useCallback(
    async (id: string, parentId: string | null, keepPosition = false) => {
      if (!controller || readOnly) return;
      await controller.runFromLatest(
        (latest) =>
          reparentBranchEntry(latest, id, parentId, layoutStrategy, keepPosition) ?? undefined,
      );
      const error = controller.getSnapshot().error;
      if (error) throw new Error(error);
      setSelectedNodeId(id);
      setSelectedEdgeId(null);
      setFocusEdgeId(null);
      if (parentId !== null && !keepPosition) setFocusNodeId(id);
    },
    [controller, layoutStrategy, readOnly, setSelectedNodeId],
  );
  const moveBranch = useCallback(
    (id: string, parentId: string | null) => guard(() => commitBranchMove(id, parentId)),
    [guard, commitBranchMove],
  );

  const pasteBranch = useCallback(
    (parentId: string) => {
      if (!controller || readOnly || !branchClipboard) return;
      const { source, copy, id } = branchClipboard;
      guard(async () => {
        const target = controller.getSnapshot().file;
        if (!copy && source === controller) {
          const edit = reparentBranchEntry(target, id, parentId, layoutStrategy);
          if (!edit) return;
          await controller.run(edit);
          if (controller.getSnapshot().error) return;
          setSelectedNodeId(id);
        } else {
          const transfer = transferBranch(
            copy ?? source.getSnapshot().file,
            target,
            id,
            parentId,
            layoutStrategy,
          );
          if (copy) await controller.run({ ...transfer.receive, label: '粘贴分支副本' });
          else await controller.moveBetween(transfer.receive, source, transfer.remove);
          if (controller.getSnapshot().error) return;
          setSelectedNodeId(transfer.id);
          setFocusNodeId(transfer.id);
        }
        if (!copy) setBranchClipboard((current) => (current === branchClipboard ? null : current));
        setSelectedEdgeId(null);
        setFocusEdgeId(null);
      });
    },
    [branchClipboard, controller, guard, layoutStrategy, readOnly, setSelectedNodeId],
  );

  const removeConnection = useCallback(
    (edge: Edge) => {
      if (!controller || readOnly) return;
      if (edge.type === 'hierarchy') {
        moveBranch(edge.toNodeId, null);
        return;
      }
      guard(async () => {
        await controller.run(removeEdgeEntry(controller.getSnapshot().file, edge.id));
        if (!controller.getSnapshot().error) setSelectedEdgeId(null);
        setFocusEdgeId(null);
      });
    },
    [controller, guard, moveBranch, readOnly],
  );

  function originalConnections(visual: VisualEdge | undefined): Edge[] {
    if (!visual || !file) return [];
    const byId = new Map(file.domain.edges.map((edge) => [edge.id, edge]));
    return visual.originalEdgeIds.flatMap((id) => {
      const original = byId.get(id);
      return original ? [original] : [];
    });
  }

  function selectConnection(id: string, focus: string | null = null): void {
    setSelectedEdgeId(id);
    setFocusEdgeId(focus);
    setSelectedNodeId(null);
    setEditingNodeId(null);
    setContextMenu(null);
  }

  function openEdgeInspector(): void {
    if (compactWorkspace) setMobilePanel('inspector');
    else setInspectorOverride(true);
  }

  function applyEdgeStyle(edgeId: string, style: EdgeStyle | null): void {
    if (!controller || readOnly) return;
    guard(() => controller.runFromLatest((latest) => setEdgeStyleEntry(latest, edgeId, style)));
  }

  async function applyBatchEdgeStyles(edgeIds: string[]): Promise<void> {
    if (!controller || readOnly || !edgeStyleClipboard) {
      throw new Error('当前项目不可编辑或没有可应用的样式');
    }
    const style: EdgeStyle = {
      color: edgeStyleClipboard.color,
      width: edgeStyleClipboard.width,
      lineStyle: edgeStyleClipboard.lineStyle,
      arrow: edgeStyleClipboard.arrow,
    };
    await controller.runFromLatest((latest) => {
      const graph = resolveVisualGraph(latest.domain, latest.presentation, {
        strategy: layoutStrategy,
      });
      const directIds = new Set(
        graph.edges.filter((edge) => edge.direct).flatMap((edge) => edge.originalEdgeIds),
      );
      const invalid = edgeIds.filter(
        (id) => !latest.domain.edges.some((edge) => edge.id === id) || !directIds.has(id),
      );
      if (invalid.length > 0) {
        throw new Error(`${invalid.length} 条目标已失效，请刷新批量列表后重试`);
      }
      return setEdgeStylesEntry(
        latest,
        edgeIds.map((edgeId) => ({ edgeId, style })),
      );
    });
  }

  function setEdgeNote(edge: Edge, note: string): void {
    if (!controller || readOnly) return;
    guard(() =>
      controller.runFromLatest((latest) => setEdgeNoteEntry(latest.domain, edge.id, note)),
    );
  }

  function editConnectionNote(edge: Edge, clientX: number, clientY: number): void {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(420, bounds.width - 16);
    setEditingEdge({
      id: edge.id,
      note: edge.note ?? '',
      x: Math.max(8, Math.min(clientX - bounds.left - width / 2, bounds.width - width - 8)),
      y: Math.max(8, Math.min(clientY - bounds.top + 12, bounds.height - 58)),
    });
  }

  function directConnection(flowEdge: FlowEdge): Edge | undefined {
    const originals = originalConnections(
      derived.graph?.edges.find((item) => item.id === flowEdge.id),
    );
    return originals.length === 1 &&
      originals[0].fromNodeId === flowEdge.source &&
      originals[0].toNodeId === flowEdge.target
      ? originals[0]
      : undefined;
  }

  function applyReconnect(edge: Edge, source: string, target: string): void {
    if (!controller || readOnly || (edge.fromNodeId === source && edge.toNodeId === target)) return;
    if (edge.type === 'hierarchy') {
      if (edge.toNodeId === target) moveBranch(target, source);
      return;
    }
    const type = edge.type;
    guard(async () => {
      await controller.runFromLatest(({ domain }) =>
        saveRelationEntry(
          domain,
          {
            type,
            note: domain.edges.find(({ id }) => id === edge.id)?.note,
            fromNodeId: source,
            toNodeId: target,
          },
          edge.id,
        ),
      );
      if (!controller.getSnapshot().error) setSelectedEdgeId(null);
      setFocusEdgeId(null);
    });
  }

  function reconnectConnection(flowEdge: FlowEdge, connection: Connection): void {
    const edge = directConnection(flowEdge);
    if (edge) applyReconnect(edge, connection.source, connection.target);
  }

  function handleConnect(connection: Connection): void {
    if (!controller || readOnly || connection.source === connection.target) return;
    const { fromNodeId, toNodeId } = orientConnection(connection, connectStartNodeId.current);
    setConnectionRequest({
      kind: 'relation',
      fromNodeId,
      toNodeId,
      allowHierarchy: true,
    });
  }

  function revealConnection(edge: Edge): void {
    if (!controller) return;
    guard(async () => {
      const latest = controller.getSnapshot().file;
      const current = latest.domain.edges.find((item) => item.id === edge.id);
      if (!current) {
        setUiError('这条关系已经被删除。');
        return;
      }
      if (current.type !== 'hierarchy') setShowRelations(true);
      setViewMode('2d');
      setProjectView('canvas');
      const paths = [current.fromNodeId, current.toNodeId].flatMap((id) =>
        pathToRoot(latest.domain.nodes, latest.domain.edges, id).slice(0, -1),
      );
      const collapsed = [...new Set(paths)].filter((id) =>
        latest.presentation.collapsedByDefault.includes(id),
      );
      if (collapsed.length) {
        if (controller.isReadOnly) controller.expandPreviewAncestors(collapsed);
        else {
          await controller.run(setCollapsedNodesEntry(latest, collapsed, false));
          if (controller.getSnapshot().error) return;
        }
      }
      const visual = derived.graph?.edges.find((item) => item.originalEdgeIds.includes(current.id));
      selectConnection(visual?.id ?? '', current.id);
      openEdgeInspector();
      window.setTimeout(() => {
        void flowApiRef.current?.fitView({
          nodes: [{ id: current.fromNodeId }, { id: current.toNodeId }],
          padding: 0.35,
          duration: 300,
        });
      }, 80);
    });
  }

  const selectedVisualEdge =
    selectedEdgeId && derived.flowEdges.some((edge) => edge.id === selectedEdgeId)
      ? derived.graph?.edges.find((edge) => edge.id === selectedEdgeId)
      : undefined;
  const selectedEdgeDetails = selectedVisualEdge ? originalConnections(selectedVisualEdge) : [];
  const focusedEdge = focusEdgeId
    ? selectedEdgeDetails.find((edge) => edge.id === focusEdgeId)
    : undefined;
  const selectedOriginalEdge =
    focusedEdge ?? (selectedVisualEdge?.direct ? selectedEdgeDetails[0] : undefined);

  useEffect(() => {
    if (!focusEdgeId) return;
    const visual = derived.graph?.edges.find((edge) => edge.originalEdgeIds.includes(focusEdgeId));
    if (visual && visual.id !== selectedEdgeId) setSelectedEdgeId(visual.id);
  }, [focusEdgeId, derived.graph, selectedEdgeId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (connectionRequest) return;
      if (pendingReconnect && event.key === 'Escape') {
        event.preventDefault();
        setPendingReconnect(null);
        return;
      }
      const target = event.target as HTMLElement | null;
      const elementTarget = event.target instanceof Element ? event.target : null;
      const isEditing =
        elementTarget?.tagName === 'INPUT' ||
        elementTarget?.tagName === 'TEXTAREA' ||
        elementTarget?.tagName === 'SELECT' ||
        Boolean((elementTarget as HTMLElement | null)?.isContentEditable) ||
        Boolean(elementTarget?.closest('.cm-editor'));
      if (
        !event.defaultPrevented &&
        !settingsOpen &&
        !projectsOpen &&
        !saveModalOpen &&
        isEventMatchingKeybinding(event, keybindings.saveBranch)
      ) {
        event.preventDefault();
        if (activeTab?.localFile && !activeTab.localFile.storage) resumeLocalFile(activeTab);
        else if (!readOnly) guard(() => controller?.saveCurrent());
        return;
      }
      if (
        !event.defaultPrevented &&
        !isEditing &&
        !settingsOpen &&
        !projectsOpen &&
        !saveModalOpen &&
        isEventMatchingKeybinding(event, keybindings.searchNodes)
      ) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.defaultPrevented || isEditing) return;
      if (event.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (mobilePanel) {
          closeMobilePanel();
          return;
        }
        setContextMenu(null);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setFocusEdgeId(null);
        setBranchClipboard(null);
        setEditingEdge(null);
        return;
      }
      if (projectView !== 'canvas' || elementTarget?.closest('.wst-project-view-switch')) return;

      if (
        !readOnly &&
        viewMode === '2d' &&
        target instanceof Node &&
        canvasRef.current?.contains(target)
      ) {
        if (
          selectedNodeId &&
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === 'c' &&
          !window.getSelection()?.toString()
        ) {
          event.preventDefault();
          putBranchOnClipboard(selectedNodeId, true);
          return;
        }
        if (selectedNodeId && isEventMatchingKeybinding(event, keybindings.cutBranch)) {
          event.preventDefault();
          putBranchOnClipboard(selectedNodeId);
          return;
        }
        if (
          branchClipboard &&
          selectedNodeId &&
          isEventMatchingKeybinding(event, keybindings.pasteBranch)
        ) {
          event.preventDefault();
          pasteBranch(selectedNodeId);
          return;
        }
        if (selectedVisualEdge && isEventMatchingKeybinding(event, keybindings.deleteNode)) {
          event.preventDefault();
          if (selectedOriginalEdge) removeConnection(selectedOriginalEdge);
          return;
        }
      }

      if (readOnly && !isEventMatchingKeybinding(event, keybindings.fitView)) return;

      // 1. 删除节点（默认 Delete / Backspace，可自定义）
      if (isEventMatchingKeybinding(event, keybindings.deleteNode)) {
        if (selectedNodeId && file && selectedNodeId !== file.domain.project.rootNodeId) {
          event.preventDefault();
          deleteNode();
          return;
        }
      }

      // 2. 新增子节点（默认 Tab，可自定义）
      if (
        viewMode === '2d' &&
        isEventMatchingKeybinding(event, keybindings.addChildNode) &&
        (event.key !== 'Tab' || canvasRef.current?.contains(target)) &&
        file
      ) {
        event.preventDefault();
        const parentId = selectedNodeId ?? file.domain.project.rootNodeId;
        addChildWithInheritedStyle(parentId, true);
        return;
      }

      // 2.5 新建分支（默认 b，可自定义）
      if (
        viewMode === '2d' &&
        isEventMatchingKeybinding(event, keybindings.addBranchNode) &&
        file
      ) {
        event.preventDefault();
        const parentId = selectedNodeId ?? file.domain.project.rootNodeId;
        addChildWithInheritedStyle(parentId, true, 'branch');
        return;
      }

      // Start an independent node in the current viewport.
      if (
        viewMode === '2d' &&
        isEventMatchingKeybinding(event, keybindings.addRandomBranch) &&
        file
      ) {
        event.preventDefault();
        addIndependentNode();
        return;
      }

      // 4. 自适应视图（默认 f，可自定义）
      if (isEventMatchingKeybinding(event, keybindings.fitView)) {
        event.preventDefault();
        setFitTrigger((value) => value + 1);
        return;
      }

      // 5. 撤销（默认 Ctrl+Z，可自定义）
      if (isEventMatchingKeybinding(event, keybindings.undo)) {
        event.preventDefault();
        guard(() => controller?.undo());
        return;
      }

      // 6. 重做（默认 Ctrl+Y / Ctrl+Shift+Z，可自定义）
      if (
        isEventMatchingKeybinding(event, keybindings.redo) ||
        ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'z')
      ) {
        event.preventDefault();
        guard(() => controller?.redo());
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    controller,
    file,
    activeTab,
    canLinkFiles,
    guard,
    selectedNodeId,
    addChildWithInheritedStyle,
    addIndependentNode,
    connectionRequest,
    pendingReconnect,
    deleteNode,
    putBranchOnClipboard,
    branchClipboard,
    pasteBranch,
    readOnly,
    removeConnection,
    selectedVisualEdge,
    selectedOriginalEdge,
    keybindings,
    projectView,
    settingsOpen,
    projectsOpen,
    saveModalOpen,
    searchOpen,
    viewMode,
    mobilePanel,
    closeMobilePanel,
  ]);

  function resetDemo(): void {
    if (!file || !controller || activeTab?.localFile) return;
    const demo = createDemoBranchFile();
    guard(async () => {
      await controller.run(replaceDomainEntry(file.domain, demo.domain));
      await controller.run(replacePresentationEntry(file.presentation, demo.presentation));
      setSelectedNodeId(null);
      setHighlightSpineIds([]);
      setFitTrigger((value) => value + 1);
    });
  }

  if (bootError) {
    return <main className="wst-fatal">启动失败：{bootError}</main>;
  }
  if (!file || !snapshot || !controller) {
    return <main className="wst-loading">正在加载画布…</main>;
  }

  const stats = snapshot.stats;
  return (
    <div
      className={`wst-app${compactWorkspace ? ' is-compact' : ''}`}
      data-testid="phase1-root"
      onDragEnter={(event) => handleFileDrag(event, 1)}
      onDragLeave={(event) => handleFileDrag(event, -1)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = enableLocalFileSync ? 'link' : 'copy';
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        fileDragDepth.current = 0;
        setFileDragOver(false);
        if (enableLocalFileSync) {
          void openLinkedFile(
            getDroppedProjectFile(event.dataTransfer).then((handle) => {
              if (!handle) setUiError('请拖入一个本地 JSON 文件，或从「导入并同步」选择原文件。');
              return handle;
            }),
          );
        } else {
          openFiles(Array.from(event.dataTransfer.files));
        }
      }}
    >
      {fileDragOver && (
        <div className="wst-file-drop" role="status">
          {enableLocalFileSync ? '松开以导入并同步分支文件' : '松开以打开分支文件'}
        </div>
      )}
      <div
        className="wst-tab-bar"
        role="tablist"
        aria-label="打开的分支文件"
        hidden={compactWorkspace && tabs.length === 1 && !activeTab?.localFile}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={`wst-tab-item ${tab.id === activeTabId ? 'is-active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleStartRenameTab(tab);
            }}
          >
            {editingTabId === tab.id ? (
              <input
                className="wst-tab-title-input"
                value={editingTabTitle}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditingTabTitle(e.target.value)}
                onBlur={() => handleCommitRenameTab(tab)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCommitRenameTab(tab);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingTabId(null);
                  }
                }}
              />
            ) : (
              <span
                className="wst-tab-title"
                title={`${tab.title} (${tab.branchName}) - 双击或点击图标重命名`}
              >
                {tab.title}
              </span>
            )}
            <span className="wst-tab-branch-badge">{tab.branchName}</span>
            {tab.controller.isReadOnly && <span className="wst-tab-branch-badge">只读预览</span>}
            {!tab.controller.isReadOnly && editingTabId !== tab.id && (
              <button
                type="button"
                className="wst-tab-rename-btn"
                title="重命名项目分支"
                aria-label={`重命名项目分支 ${tab.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleStartRenameTab(tab);
                }}
              >
                <WorkspaceIcon name="pencil" size={11} />
              </button>
            )}
            {tabs.length > 1 && (
              <button
                type="button"
                className="wst-tab-close"
                title="关闭此标签页"
                aria-label={`关闭标签页 ${tab.title}`}
                onClick={(e) => handleCloseTab(tab.id, e)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="wst-tab-add-btn"
          title="新建分支标签页"
          aria-label="新建分支标签页"
          onClick={() => void handleNewTab()}
        >
          +
        </button>
        <button
          type="button"
          className="wst-tab-projects-btn"
          title={storageScope === 'account' ? '管理账号项目' : '管理本地项目'}
          aria-label={storageScope === 'account' ? '管理账号项目' : '管理本地项目'}
          onClick={() => setProjectsOpen(true)}
        >
          <WorkspaceIcon name="folder" size={14} />
        </button>
      </div>
      <WorkspaceToolbar
        compact={compactWorkspace}
        directoryOpen={directoryOpen}
        directoryToggleRef={directoryToggleRef}
        onToggleDirectory={() => {
          if (compactWorkspace) setMobilePanel(directoryOpen ? null : 'directory');
          else setDesktopDirectoryOpen((open) => !open);
        }}
        file={file}
        accountControl={accountControl}
        readOnly={readOnly}
        onRenameProject={handleRenameProject}
        projectView={projectView}
        edgeCount={derived.flowEdges.length}
        hiddenCount={derived.hidden}
        undoDepth={snapshot.undoDepth}
        redoDepth={snapshot.redoDepth}
        viewMode={viewMode}
        resizeMode={resizeMode}
        layoutDirection={layoutDirection}
        layoutStrategy={layoutStrategy}
        showRelations={showRelations}
        highlight={derived.highlight}
        highlightSpineIds={highlightSpineIds}
        inspectorOpen={inspectorOpen}
        inspectorToggleRef={inspectorToggleRef}
        canDeleteNode={Boolean(selectedNode && selectedNode.id !== file.domain.project.rootNodeId)}
        onAddNode={addNode}
        onAddBranch={addBranch}
        onAddRandomBranch={() => addIndependentNode()}
        onDeleteNode={deleteNode}
        onUndo={() => guard(() => controller.undo())}
        onRedo={() => guard(() => controller.redo())}
        onProjectView={(view) => {
          setMobilePanel(null);
          setContextMenu(null);
          setSelectedEdgeId(null);
          setFocusEdgeId(null);
          setEditingEdge(null);
          setProjectView(view);
        }}
        onViewMode={(mode) => {
          setSelectedEdgeId(null);
          setFocusEdgeId(null);
          setEditingEdge(null);
          setViewMode(mode);
        }}
        onResizeMode={setResizeMode}
        onLayoutStrategy={(strategy) => {
          setLayoutStrategy(strategy);
          setFitTrigger((value) => value + 1);
        }}
        onLayoutDirection={(direction) =>
          guard(async () => {
            if (direction === layoutDirection) return;
            await controller.run(setLayoutDirectionEntry(file, direction));
            setFitTrigger((value) => value + 1);
          })
        }
        onToggleRelations={() => {
          setSelectedEdgeId(null);
          setFocusEdgeId(null);
          setEditingEdge(null);
          setShowRelations((value) => !value);
        }}
        onResetLayout={() =>
          guard(async () => {
            await controller.run(clearPositionsEntry(file, layoutDirection));
            setFitTrigger((value) => value + 1);
          })
        }
        onFitView={() => setFitTrigger((value) => value + 1)}
        onCreateSpine={() => createSpine()}
        onRenameSpine={renameSpine}
        onRemoveSpine={removeSpine}
        onLocateNode={(id) => locateProjectNode(id, false)}
        onCreateSpineForLeaf={(leafNodeId, title) => createSpine(leafNodeId, title)}
        onToggleSpine={(id) =>
          setHighlightSpineIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
        onClearSpines={() => setHighlightSpineIds([])}
        onToggleInspector={() => {
          if (compactWorkspace) setMobilePanel(inspectorOpen ? null : 'inspector');
          else setInspectorOverride(!inspectorOpen);
        }}
        onImport={importProject}
        syncImport={enableLocalFileSync}
        linkedFile={Boolean(activeTab?.localFile)}
        onExportJson={exportJson}
        onExportSvg={exportSvgFile}
        onResetDemo={resetDemo}
        onOpenSettings={() => {
          setMobilePanel(null);
          setSettingsOpen(true);
        }}
        onOpenProjects={() => setProjectsOpen(true)}
        onNewProjectTab={() => void handleNewTab()}
        onOpenSearch={() => {
          setMobilePanel(null);
          setSearchOpen(true);
        }}
        searchShortcut={keybindings.searchNodes}
      />
      {!enableLocalFileSync && (
        <input ref={importRef} type="file" accept=".json" multiple hidden onChange={importJson} />
      )}
      {missingFileSnapshot && <main className="wst-loading">恢复同步后即可查看此项目。</main>}

      <div
        className="wst-body"
        style={missingFileSnapshot ? { display: 'none' } : undefined}
        onClick={() => setContextMenu(null)}
      >
        {projectView === 'canvas' && (
          <DateDirectory
            key={`dates-${activeTabId}`}
            nodes={file.domain.nodes}
            domain={file.domain}
            selectedId={selectedNodeId}
            compact={compactWorkspace}
            open={directoryOpen}
            onClose={() => {
              if (compactWorkspace) closeMobilePanel();
              else {
                setDesktopDirectoryOpen(false);
                directoryToggleRef.current?.focus({ preventScroll: true });
              }
            }}
            onLocate={(id) => locateProjectNode(id, false)}
            onToggleTodo={readOnly ? undefined : toggleTodo}
          />
        )}
        {compactWorkspace && mobilePanel && projectView === 'canvas' && (
          <div className="wst-panel-scrim" aria-hidden="true" onClick={closeMobilePanel} />
        )}
        <main
          className="wst-canvas"
          ref={canvasRef}
          tabIndex={-1}
          aria-label="项目画布"
          inert={projectView === 'todos' || (compactWorkspace && mobilePanel !== null)}
        >
          {viewMode === '3d' && derived.graph ? (
            <Suspense fallback={<main className="wst-loading">正在加载三维渲染器…</main>}>
              <ThreeCanvas
                graph={derived.graph}
                nodes={file.domain.nodes}
                blocks={file.domain.blocks}
                assets={file.domain.assets}
                selectedNodeId={selectedNodeId}
                visibleEdgeTypes={visibleTypes}
                fitTrigger={fitTrigger}
                focusNodeId={focusNodeId}
                onFocused={clearFocus}
                highlightNodeKey={highlightNodeKey}
                highlightEdgeKey={highlightEdgeKey}
                onSelect={setSelectedNodeId}
                onError={(message) => {
                  setUiError(message);
                  setViewMode('2d');
                }}
              />
            </Suspense>
          ) : (
            <ReactFlow
              className={`wst-flow-${layoutDirection}`}
              nodes={nodes}
              edges={derived.flowEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onNodeClick={(_, node) => {
                if (pendingReconnect) {
                  const { edge, end } = pendingReconnect;
                  setPendingReconnect(null);
                  applyReconnect(
                    edge,
                    end === 'source' ? node.id : edge.fromNodeId,
                    end === 'target' ? node.id : edge.toNodeId,
                  );
                }
                setSelectedEdgeId(null);
                setFocusEdgeId(null);
                setEditingEdge(null);
                canvasRef.current?.focus({ preventScroll: true });
              }}
              onPaneClick={() => {
                if (pendingReconnect) {
                  setPendingReconnect(null);
                  return;
                }
                canvasRef.current?.focus({ preventScroll: true });
                setSelectedNodeIds([]);
                setSelectedEdgeId(null);
                setFocusEdgeId(null);
                setEditingEdge(null);
                setEditingNodeId(null);
                setContextMenu(null);
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                if (readOnly) return;
                setPendingReconnect(null);
                setSelectedEdgeId(null);
                setFocusEdgeId(null);
                if (!selectedNodeIds.includes(node.id)) {
                  setSelectedNodeIds([node.id]);
                }
                setContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  kind: 'node',
                  targetId: node.id,
                });
              }}
              onDoubleClick={(event) => {
                if (
                  !readOnly &&
                  event.target instanceof Element &&
                  event.target.classList.contains('react-flow__pane')
                ) {
                  addIndependentNode({ x: event.clientX, y: event.clientY });
                }
              }}
              onContextMenu={(event) => {
                if (
                  !(event.target instanceof Element) ||
                  !event.target.classList.contains('react-flow__pane')
                )
                  return;
                event.preventDefault();
                if (readOnly) return;
                setContextMenu({ x: event.clientX, y: event.clientY, kind: 'pane' });
              }}
              onEdgeClick={(event, edge) => {
                selectConnection(edge.id);
                const target = event.target;
                const end =
                  target instanceof Element &&
                  target.classList.contains('react-flow__edgeupdater-source')
                    ? 'source'
                    : target instanceof Element &&
                        target.classList.contains('react-flow__edgeupdater-target')
                      ? 'target'
                      : null;
                const original = end && !readOnly ? directConnection(edge) : undefined;
                setPendingReconnect(original && end ? { edge: original, end } : null);
                if (!end) openEdgeInspector();
                canvasRef.current?.focus({ preventScroll: true });
              }}
              onEdgeDoubleClick={(event, edge) => {
                if (readOnly) return;
                event.stopPropagation();
                selectConnection(edge.id);
                const visual = derived.graph?.edges.find((item) => item.id === edge.id);
                const originals = originalConnections(visual);
                const original = originals.length === 1 ? originals[0] : undefined;
                if (
                  original &&
                  original.fromNodeId === edge.source &&
                  original.toNodeId === edge.target
                ) {
                  editConnectionNote(original, event.clientX, event.clientY);
                } else {
                  setContextMenu({
                    x: event.clientX,
                    y: event.clientY,
                    kind: 'edge',
                    targetId: edge.id,
                  });
                }
              }}
              onEdgeContextMenu={(event, edge) => {
                event.preventDefault();
                if (readOnly) return;
                setPendingReconnect(null);
                selectConnection(edge.id);
                setContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  kind: 'edge',
                  targetId: edge.id,
                });
              }}
              onReconnect={reconnectConnection}
              onReconnectStart={(_, edge) => {
                setPendingReconnect(null);
                draggingEdge.current = directConnection(edge) ?? null;
              }}
              onReconnectEnd={() => {
                draggingEdge.current = null;
              }}
              onConnect={handleConnect}
              onConnectStart={(_, params) => {
                connectStartNodeId.current = params.nodeId;
              }}
              onConnectEnd={() => {
                connectStartNodeId.current = null;
              }}
              isValidConnection={({ source, target }) => {
                if (source === target) return false;
                const edge = draggingEdge.current;
                if (!edge) return true;
                if (edge.type === 'hierarchy') {
                  return (
                    target === edge.toNodeId &&
                    !pathToRoot(file.domain.nodes, file.domain.edges, source).includes(target)
                  );
                }
                return !file.domain.edges.some(
                  (item) =>
                    item.id !== edge.id &&
                    item.type === edge.type &&
                    item.fromNodeId === source &&
                    item.toNodeId === target,
                );
              }}
              connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 2, strokeDasharray: '5 5' }}
              connectionMode={ConnectionMode.Loose}
              connectionRadius={24}
              connectOnClick={false}
              zoomOnDoubleClick={readOnly}
              {...nodeDragHandlers}
              nodesConnectable={!readOnly}
              nodesDraggable={!readOnly}
              deleteKeyCode={null}
              selectionOnDrag={!compactWorkspace}
              selectionMode={SelectionMode.Partial}
              panOnDrag={compactWorkspace ? true : [1, 2]}
              multiSelectionKeyCode={['Shift', 'Meta']}
              fitView
              fitViewOptions={{ padding: compactWorkspace ? 0.18 : FIT_PADDING[layoutDirection] }}
              minZoom={compactWorkspace ? 0.035 : 0.1}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
            >
              <FlowViewportController
                fitTrigger={fitTrigger}
                focusNodeId={focusNodeId}
                editingNodeId={editingNodeId}
                projectKey={activeTabId}
                compact={compactWorkspace}
                rootId={file.domain.project.rootNodeId}
                onFocused={clearFocus}
                direction={layoutDirection}
                apiRef={flowApiRef}
              />
              {derived.graph && layoutStrategy === 'date-priority' && (
                <TimelineAxis
                  graph={derived.graph}
                  direction={layoutDirection}
                  onSelectDateNodes={(ids) => setSelectedNodeIds(ids)}
                />
              )}
              <Background gap={20} size={1} />
              {guides.length > 0 && (
                <ViewportPortal>
                  <svg className="wst-drag-guides" aria-hidden="true">
                    {guides.map((guide) => (
                      <line
                        key={guide.x1 === guide.x2 ? 'vertical' : 'horizontal'}
                        {...guide}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </svg>
                </ViewportPortal>
              )}
              <Controls
                position={compactWorkspace ? 'bottom-right' : 'bottom-left'}
                orientation={compactWorkspace ? 'horizontal' : 'vertical'}
              />
              {!compactWorkspace && (
                <MiniMap pannable zoomable style={{ width: 150, height: 108 }} />
              )}
            </ReactFlow>
          )}
          <WorkspacePopover label="操作指南" icon="help" align="start" className="wst-view-help">
            {() => (
              <>
                <div className="wst-popover-heading">操作指南</div>
                <ul className="wst-help-list">
                  {compactWorkspace ? (
                    <>
                      <li>拖动空白处平移，双指缩放</li>
                      <li>点选卡片后打开属性查看笔记和任务</li>
                    </>
                  ) : viewMode === '3d' ? (
                    <>
                      <li>左键拖动旋转，右键拖动平移</li>
                      <li>滚轮缩放，点击选中节点</li>
                    </>
                  ) : (
                    <>
                      <li>左键拖动框选，中键或右键平移</li>
                      <li>
                        拖动节点时按住 <kbd>Ctrl</kbd> 对齐附近节点
                      </li>
                      <li>
                        按住 <kbd>Shift</kbd> 点击可多选节点
                      </li>
                      <li>悬停节点圆点拖拽连线，双击卡片编辑</li>
                      <li>
                        拖动四角调整尺寸（
                        <kbd>{keybindings.resizeProportional}</kbd> 等比、
                        <kbd>{keybindings.resizeBranch}</kbd> 分支联动、
                        <kbd>{keybindings.resizeNodeScale}</kbd> 节点等比吸附）
                      </li>
                      <li>
                        <kbd>{keybindings.addChildNode}</kbd> 新建子节点，
                        <kbd>{keybindings.deleteNode}</kbd> 删除节点
                      </li>
                      <li>
                        <kbd>{keybindings.addRandomBranch}</kbd> 新建独立节点，
                        <kbd>{keybindings.fitView}</kbd> 适应视图
                      </li>
                    </>
                  )}
                </ul>
              </>
            )}
          </WorkspacePopover>
          {pendingReconnect && !readOnly && (
            <div className="wst-reconnect-status" role="status">
              {pendingReconnect.edge.type === 'hierarchy'
                ? '选择新母节点，整支会随之移动'
                : pendingReconnect.end === 'source'
                  ? '选择新的起点'
                  : '选择新的终点'}
              <button className="wst-tool" type="button" onClick={() => setPendingReconnect(null)}>
                取消
              </button>
            </div>
          )}
          {editingEdge && !readOnly && (
            <form
              className="wst-edge-note-form"
              style={{ left: editingEdge.x, top: editingEdge.y }}
              onSubmit={(event) => {
                event.preventDefault();
                const edit = editingEdge;
                guard(async () => {
                  const latest = controller.getSnapshot().file.domain;
                  const current = latest.edges.find((item) => item.id === edit.id);
                  if (!current) {
                    setEditingEdge(null);
                    return;
                  }
                  if ((current.note ?? '') !== edit.note.trim()) {
                    await controller.run(setEdgeNoteEntry(latest, edit.id, edit.note));
                    if (controller.getSnapshot().error) return;
                  }
                  setEditingEdge(null);
                  canvasRef.current?.focus({ preventScroll: true });
                });
              }}
            >
              <label htmlFor="wst-edge-note">连线备注</label>
              <input
                id="wst-edge-note"
                autoFocus
                value={editingEdge.note}
                onChange={(event) => setEditingEdge({ ...editingEdge, note: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditingEdge(null);
                    canvasRef.current?.focus({ preventScroll: true });
                  }
                }}
              />
              <button type="submit" className="wst-tool">
                保存
              </button>
              <button type="button" className="wst-tool" onClick={() => setEditingEdge(null)}>
                取消
              </button>
            </form>
          )}
          {contextMenu && !readOnly && (
            <div
              className="wst-context-menu"
              style={compactWorkspace ? undefined : { left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              {contextMenu.kind === 'node' && contextMenu.targetId && (
                <>
                  {contextMenu.targetId !== file.domain.project.rootNodeId && (
                    <button
                      type="button"
                      className="wst-context-item"
                      onClick={() => {
                        setConnectionRequest({ kind: 'move', nodeId: contextMenu.targetId! });
                        setContextMenu(null);
                      }}
                    >
                      挂到…
                    </button>
                  )}
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      setConnectionRequest({ kind: 'adopt', nodeId: contextMenu.targetId! });
                      setContextMenu(null);
                    }}
                  >
                    接入已有分支
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    disabled={contextMenu.targetId === file.domain.project.rootNodeId}
                    onClick={() => {
                      putBranchOnClipboard(contextMenu.targetId!);
                      setContextMenu(null);
                    }}
                  >
                    剪切分支 ({keybindings.cutBranch})
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    disabled={contextMenu.targetId === file.domain.project.rootNodeId}
                    onClick={() => {
                      putBranchOnClipboard(contextMenu.targetId!, true);
                      setContextMenu(null);
                    }}
                  >
                    复制分支 (Ctrl+C)
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    disabled={!branchClipboard || cutBranchId === contextMenu.targetId}
                    onClick={() => {
                      pasteBranch(contextMenu.targetId!);
                      setContextMenu(null);
                    }}
                  >
                    粘贴为子分支 ({keybindings.pasteBranch})
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      const id = contextMenu.targetId!;
                      guard(async () => {
                        const edit = restoreBranchLayoutEntry(
                          controller.getSnapshot().file,
                          id,
                          layoutDirection,
                        );
                        if (edit) await controller.run(edit);
                      });
                      setContextMenu(null);
                    }}
                  >
                    恢复此分支自动布局
                  </button>
                  <div className="wst-context-sep" />
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      handleStartEdit(contextMenu.targetId!);
                      setContextMenu(null);
                    }}
                  >
                    ✏️ 编辑标题 / Markdown 笔记
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      addChildWithInheritedStyle(contextMenu.targetId!, true);
                      setContextMenu(null);
                    }}
                  >
                    ➕ 新建节点 (Tab)
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      addChildWithInheritedStyle(contextMenu.targetId!, true, 'branch');
                      setContextMenu(null);
                    }}
                  >
                    🌿 新建分支 ({keybindings.addBranchNode})
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      setFocusNodeId(contextMenu.targetId!);
                      setContextMenu(null);
                    }}
                  >
                    🎯 聚焦此节点
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      const targetId = contextMenu.targetId!;
                      guard(() =>
                        controller.run(
                          setCollapsedEntry(
                            file,
                            targetId,
                            !file.presentation.collapsedByDefault.includes(targetId),
                          ),
                        ),
                      );
                      setContextMenu(null);
                    }}
                  >
                    {file.presentation.collapsedByDefault.includes(contextMenu.targetId)
                      ? '📂 展开分支'
                      : '📦 折叠分支'}
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      const targetId = contextMenu.targetId!;
                      const current = file.presentation.branchScales[targetId] ?? 1;
                      guard(() =>
                        controller.run(
                          setBranchScaleEntry(file, targetId, current < 0.8 ? 1 : 0.5),
                        ),
                      );
                      setContextMenu(null);
                    }}
                  >
                    {(file.presentation.branchScales[contextMenu.targetId] ?? 1) < 0.8
                      ? '🔎 恢复分支 100%'
                      : '🗜️ 缩小此分支 (50%)'}
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      const targetId = contextMenu.targetId!;
                      guard(() =>
                        controller.run(clearPositionEntry(file, targetId, layoutDirection)),
                      );
                      setContextMenu(null);
                    }}
                  >
                    🔄 恢复此节点自动位置
                  </button>
                  <div className="wst-context-sep" />
                  <button
                    type="button"
                    className="wst-context-item is-danger"
                    disabled={contextMenu.targetId === file.domain.project.rootNodeId}
                    onClick={() => {
                      const targetId = contextMenu.targetId!;
                      if (targetId !== file.domain.project.rootNodeId) {
                        guard(() =>
                          controller.runFromLatest((latest) =>
                            deleteSubtreeEntry(latest, targetId),
                          ),
                        );
                        setSelectedNodeIds([]);
                      }
                      setContextMenu(null);
                    }}
                  >
                    🗑️ 删除节点子树
                  </button>
                </>
              )}
              {contextMenu.kind === 'pane' && (
                <>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      addNode();
                      setContextMenu(null);
                    }}
                  >
                    ➕ 新建子节点
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      addIndependentNode({ x: contextMenu.x, y: contextMenu.y });
                      setContextMenu(null);
                    }}
                  >
                    新建独立节点
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      setFitTrigger((value) => value + 1);
                      setContextMenu(null);
                    }}
                  >
                    🔍 自适应视图 (F)
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      const nextDir: LayoutDirection =
                        layoutDirection === 'vertical' ? 'horizontal' : 'vertical';
                      guard(async () => {
                        await controller.run(setLayoutDirectionEntry(file, nextDir));
                        setFitTrigger((value) => value + 1);
                      });
                      setContextMenu(null);
                    }}
                  >
                    ↕️ 切换为{layoutDirection === 'vertical' ? '从左到右' : '从上到下'}
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      setShowRelations((value) => !value);
                      setContextMenu(null);
                    }}
                  >
                    🔗 {showRelations ? '隐藏关系图层' : '显示关系图层'}
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    onClick={() => {
                      guard(async () => {
                        await controller.run(clearPositionsEntry(file, layoutDirection));
                        setFitTrigger((value) => value + 1);
                      });
                      setContextMenu(null);
                    }}
                  >
                    🧭 全部恢复时间布局
                  </button>
                  <div className="wst-context-sep" />
                  <button
                    type="button"
                    className="wst-context-item"
                    disabled={snapshot.undoDepth === 0}
                    onClick={() => {
                      guard(() => controller.undo());
                      setContextMenu(null);
                    }}
                  >
                    ↩️ 撤销 (Ctrl+Z)
                  </button>
                  <button
                    type="button"
                    className="wst-context-item"
                    disabled={snapshot.redoDepth === 0}
                    onClick={() => {
                      guard(() => controller.redo());
                      setContextMenu(null);
                    }}
                  >
                    ↪️ 重做 (Ctrl+Y)
                  </button>
                </>
              )}
              {contextMenu.kind === 'edge' && contextMenu.targetId && (
                <>
                  {originalConnections(
                    derived.graph?.edges.find((edge) => edge.id === contextMenu.targetId),
                  ).map((edge) => {
                    const from = file.domain.nodes.find(
                      (node) => node.id === edge.fromNodeId,
                    )?.title;
                    const to = file.domain.nodes.find((node) => node.id === edge.toNodeId)?.title;
                    return (
                      <div className="wst-edge-menu-item" key={edge.id}>
                        <small title={edge.id}>
                          {from} → {to}
                        </small>
                        <button
                          type="button"
                          className="wst-context-item"
                          onClick={() => {
                            setConnectionRequest(
                              edge.type === 'hierarchy'
                                ? { kind: 'move', nodeId: edge.toNodeId }
                                : {
                                    kind: 'relation',
                                    edgeId: edge.id,
                                    fromNodeId: edge.fromNodeId,
                                    toNodeId: edge.toNodeId,
                                  },
                            );
                            setContextMenu(null);
                          }}
                        >
                          {edge.type === 'hierarchy' ? '更换母节点' : '编辑关联'}
                        </button>
                        <button
                          type="button"
                          className="wst-context-item"
                          onClick={() => {
                            editConnectionNote(edge, contextMenu.x, contextMenu.y);
                            setContextMenu(null);
                          }}
                        >
                          编辑备注
                        </button>
                        {(!visibleNodeIds.has(edge.fromNodeId) ||
                          !visibleNodeIds.has(edge.toNodeId)) && (
                          <button
                            type="button"
                            className="wst-context-item"
                            onClick={() => {
                              revealConnection(edge);
                              setContextMenu(null);
                            }}
                          >
                            展开并定位原始连线
                          </button>
                        )}
                        <button
                          type="button"
                          className="wst-context-item is-danger"
                          onClick={() => {
                            removeConnection(edge);
                            setContextMenu(null);
                          }}
                        >
                          {edge.type === 'hierarchy' ? '解除父子连接' : '删除关联连线'}
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </main>

        <WorkspaceInspector
          key={`inspector-${activeTabId}`}
          open={inspectorOpen}
          readOnly={readOnly}
          inert={projectView === 'todos'}
          file={file}
          node={selectedNode}
          visualEdge={selectedVisualEdge ?? null}
          selectedEdges={selectedEdgeDetails}
          focusEdgeId={selectedOriginalEdge?.id ?? null}
          edgeClipboard={edgeStyleClipboard}
          selectedCount={selectedNodeIds.length}
          hiddenRelations={selectedNode ? (derived.counts[selectedNode.id] ?? 0) : 0}
          direction={layoutDirection}
          visibleNodeIds={visibleNodeIds}
          controller={controller}
          guard={guard}
          onScalePreview={previewInspectorScale}
          onScaleApply={applyInspectorScale}
          onClose={() => {
            if (compactWorkspace) closeMobilePanel();
            else {
              setInspectorOverride(false);
              inspectorToggleRef.current?.focus();
            }
          }}
          autoSave={settings.autoSaveNode}
          onLocate={locateNode}
          onConnection={setConnectionRequest}
          onDetach={(id) => moveBranch(id, null)}
          onMoveBranch={(id) => setConnectionRequest({ kind: 'move', nodeId: id })}
          onDeleteEdge={removeConnection}
          onRevealEdge={revealConnection}
          onSetEdgeNote={setEdgeNote}
          onApplyEdgeStyle={applyEdgeStyle}
          onCopyEdgeStyle={setEdgeStyleClipboard}
          onOpenEdgeBatch={() => setEdgeBatchOpen(true)}
          onEdgeDraftChange={setEdgeDraftDirty}
          onDelete={
            !readOnly && selectedNode?.id !== file.domain.project.rootNodeId
              ? deleteNode
              : undefined
          }
          onEditOnCanvas={
            !readOnly && viewMode === '2d'
              ? (id) => {
                  if (compactWorkspace) setMobilePanel(null);
                  locateNode(id);
                  handleStartEdit(id);
                }
              : undefined
          }
        />
        <WorkspaceTodos
          key={activeTabId}
          domain={file.domain}
          hidden={projectView !== 'todos'}
          readOnly={readOnly}
          onLocate={(id) => locateProjectNode(id, true)}
          undoDepth={snapshot.undoDepth}
          redoDepth={snapshot.redoDepth}
          onUndo={() => guard(() => controller.undo())}
          onRedo={() => guard(() => controller.redo())}
          onCreate={(draft) => {
            const day = localToday();
            setUiError(null);
            return controller.runFromLatest((latest) => saveTodoEntry(latest, null, draft, day));
          }}
          onUpdate={updateTodo}
          onDelete={(source) =>
            controller.runFromLatest((latest) => deleteTodoEntry(latest, source))
          }
        />
      </div>

      <footer className="wst-status">
        <span className="wst-last-action" data-testid="last-action" role="status">
          {snapshot.lastAction}
        </span>
        <span data-testid="undo-depth">可撤销 {snapshot.undoDepth}</span>
        <span data-testid="semantic-commits">语义 Commit {stats.semanticCommits}</span>
        <span data-testid="presentation-batches">呈现批次 {stats.presentationBatches}</span>
        <span data-testid="svg-meta">SVG {svgMeta}</span>
        {(localFileIssue || uiError || snapshot.error || activeTab?.localFile?.issue) && (
          <span className="wst-error" role="alert">
            {localFileIssue ?? uiError ?? snapshot.error ?? activeTab?.localFile?.issue}
          </span>
        )}
        {accountNotice && (
          <span className="wst-scope-badge" role="status">
            {accountNotice}
          </span>
        )}
        <span className="wst-scope-badge" data-testid="storage-scope">
          {activeTab?.localFile?.storage
            ? `同步文件 · ${activeTab.localFile.handle?.name}`
            : activeTab?.localFile
              ? '本地文件同步已暂停'
              : storageScope === 'account'
                ? '账号云端项目'
                : '本地浏览器项目'}
        </span>
        {activeTab?.localFile && !activeTab.localFile.storage && (
          <button type="button" className="wst-tool" onClick={() => resumeLocalFile(activeTab)}>
            恢复同步
          </button>
        )}
      </footer>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        keybindings={keybindings}
        scaleSettings={file?.presentation.scaleSettings ?? DEFAULT_SCALE_SETTINGS}
        onClose={() => setSettingsOpen(false)}
        onChangeSettings={setSettings}
        onChangeKeybindings={setKeybindings}
        onChangeScaleSettings={(nextScaleSettings) => {
          if (!controller || readOnly || !file) return;
          guard(() => controller.run(setScaleSettingsEntry(file, nextScaleSettings)));
        }}
      />

      {editingNodeId &&
        (() => {
          const editingNode = file?.domain.nodes.find((n) => n.id === editingNodeId);
          if (!editingNode || !file) return null;
          const note = getNodeNote(file.domain, editingNode.id);
          return (
            <NodeEditorOverlay
              id={editingNode.id}
              title={editingNode.title}
              note={note}
              assets={file.domain.assets}
              autoSaveEnabled={settings.autoSaveNode}
              autoSaveInterval={settings.autoSaveInterval}
              onSave={persistNodeDraft}
              onClose={() => setEditingNodeId(null)}
            />
          );
        })()}

      <ProjectsModal
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        storage={storageRef.current}
        scope={storageScope}
        openProjectIds={tabs.filter((t) => !t.localFile).map((t) => t.projectId)}
        onOpenProject={handleOpenProjectById}
        onCreateProject={handleNewTab}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProjectById}
      />

      <SaveProjectModal
        open={saveModalOpen}
        onClose={() => setSaveModalOpen(false)}
        file={file}
        onSaved={(_name) => {
          setUiError(null);
        }}
      />

      {connectionRequest && !readOnly && (
        <ConnectionDialog
          domain={file.domain}
          request={connectionRequest}
          onClose={() => setConnectionRequest(null)}
          onSave={async ({ fromNodeId, toNodeId, type, note, keepPosition }) => {
            setUiError(null);
            if (type === 'hierarchy') {
              await commitBranchMove(toNodeId, fromNodeId, keepPosition);
              return;
            }
            const id = connectionRequest.kind === 'relation' ? connectionRequest.edgeId : undefined;
            await controller.runFromLatest(({ domain }) =>
              saveRelationEntry(domain, { fromNodeId, toNodeId, type, note }, id),
            );
            const error = controller.getSnapshot().error;
            if (error) throw new Error(error);
            setShowRelations(true);
            setSelectedEdgeId(null);
            setFocusEdgeId(null);
          }}
        />
      )}

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        domain={file.domain}
        onSelectNode={(nodeId) => locateProjectNode(nodeId, true)}
        onSelectEdge={(edgeId) => {
          const edge = file.domain.edges.find((item) => item.id === edgeId);
          if (edge) revealConnection(edge);
        }}
      />

      {edgeBatchOpen && (
        <EdgeStyleBatchDialog
          file={file}
          graphEdges={derived.graph?.edges ?? []}
          initialEdgeId={selectedOriginalEdge?.id ?? null}
          clipboard={edgeStyleClipboard}
          onClose={() => setEdgeBatchOpen(false)}
          onApply={applyBatchEdgeStyles}
        />
      )}

      {accountDialog}
    </div>
  );
}
