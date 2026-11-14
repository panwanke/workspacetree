import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  applyNodeChanges,
  useReactFlow,
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
  type VisibleEdgeTypes,
  type VisualGraph,
  type VisualEdge,
} from '@workspacetree/layout';
import { exportSvg } from '@workspacetree/export';
import {
  FILE_SUFFIX,
  type BranchFile,
  type Edge,
  type HierarchyEdgeRole,
} from '@workspacetree/schema';
import { createBrowserStorageAdapter, type IdbJsonStorageAdapter } from '@workspacetree/storage';
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
} from 'react';
import CanvasNode, { type CardNode } from './CanvasNode';
import DateDirectory from './DateDirectory';
import RelationEdge from './RelationEdge';
import TimelineAxis from './TimelineAxis';
import WorkspaceInspector, { type ScaleKind } from './WorkspaceInspector';
import WorkspaceTodos from './WorkspaceTodos';
import { saveTodoEntry } from './todo-editing';
import WorkspaceToolbar, {
  WorkspacePopover,
  type ProjectView,
  type ResizeMode,
  type ViewMode,
} from './WorkspaceToolbar';
import { createDemoBranchFile, createEmptyBranchFile } from './demo';
import { EditorController, type EditorSnapshot } from './editor';
import { branchSnapshotHash, openBranchFile } from './open-branch-file';
import { reparentBranchEntry, restoreBranchLayoutEntry, transferBranch } from './branch-editing';
import { reconnectEdgeEntry, setEdgeNoteEntry } from './edge-editing';
import { isEventMatchingKeybinding, loadKeybindings, type KeybindingAction } from './keybindings';
import SettingsModal from './SettingsModal';
import {
  addEdgeEntry,
  clearPositionEntry,
  clearPositionsEntry,
  createNodeEntry,
  createSpineEntry,
  deleteSubtreeEntry,
  getNodeNote,
  removeEdgeEntry,
  renameNodeEntry,
  replaceDomainEntry,
  replacePresentationEntry,
  scaledCustomSize,
  setBranchScaleEntry,
  setCollapsedEntry,
  setCollapsedNodesEntry,
  setLayoutDirectionEntry,
  setNodeNoteEntry,
  setNodeScaleEntry,
  setNodeSizeEntry,
} from './history';

const ThreeCanvas = lazy(() => import('./ThreeCanvas'));
const nodeTypes = { card: CanvasNode };
const edgeTypes = { relation: RelationEdge };
const ALL_EDGE_TYPES: VisibleEdgeTypes = ['hierarchy', 'dependency', 'reference', 'custom'];
const COMPACT_WORKSPACE = '(max-width: 760px)';
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
  onFocused,
  direction,
  apiRef,
}: {
  fitTrigger: number;
  focusNodeId: string | null;
  onFocused: () => void;
  direction: LayoutDirection;
  apiRef?: React.MutableRefObject<FlowViewportAPI | null>;
}) {
  const reactFlow = useReactFlow();

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
      void reactFlow.fitView({ padding: FIT_PADDING[direction], duration: 280 });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [fitTrigger, reactFlow, direction]);

  useEffect(() => {
    if (!focusNodeId) return;
    void reactFlow.fitView({ nodes: [{ id: focusNodeId }], padding: 0.85, duration: 300 });
    onFocused();
  }, [focusNodeId, reactFlow, onFocused]);

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
}

export default function App() {
  const storageRef = useRef<IdbJsonStorageAdapter | null>(null);
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
  const [fitTrigger, setFitTrigger] = useState(0);
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
  const inspectorOpen = inspectorOverride ?? !compactWorkspace;
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const [svgMeta, setSvgMeta] = useState('尚未导出');
  const [uiError, setUiError] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [keybindings, setKeybindings] = useState<Record<KeybindingAction, string>>(() =>
    loadKeybindings(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const booted = useRef(false);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    if (selectedNodeIds.length > 0) {
      setSelectedEdgeId(null);
      setEditingEdge(null);
    }
  }, [selectedNodeIds]);

  useEffect(() => {
    setScalePreview(null);
  }, [selectedNodeId, inspectorOpen, projectView]);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_WORKSPACE);
    const update = (event: MediaQueryListEvent) => setCompactWorkspace(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void (async () => {
      try {
        const storage = await createBrowserStorageAdapter();
        storageRef.current = storage;
        const editor = await EditorController.bootstrap(storage, createDemoBranchFile);
        const demoTab: WorkspaceTab = {
          id: makeId('tab_'),
          title: editor.getSnapshot().file.domain.project.title || '演示项目',
          projectId: editor.getSnapshot().file.projectId,
          branchName: editor.getSnapshot().file.activeBranch,
          controller: editor,
        };
        setTabs([demoTab]);
        setActiveTabId(demoTab.id);
        setController(editor);
        setSnapshot(editor.getSnapshot());
      } catch (cause) {
        setBootError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, []);

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );
  const tabController = activeTab?.controller;

  useEffect(() => {
    if (!tabController) return;
    setController(tabController);
    setSnapshot(tabController.getSnapshot());
    setSelectedNodeIds([]);
    setSelectedEdgeId(null);
    setEditingEdge(null);
    setContextMenu(null);
    setEditingNodeId(null);
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
  const readOnly = controller?.isReadOnly ?? false;
  const layoutDirection = file ? resolveLayoutDirection(file.presentation) : 'vertical';
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

  const handleCommitEdit = useCallback(
    (id: string, nextTitle: string, nextNote: string) => {
      if (!controller || !file) return;
      setEditingNodeId(null);
      const currentNode = file.domain.nodes.find((item) => item.id === id);
      if (!currentNode) return;
      const currentNote = getNodeNote(file.domain, id);
      guard(async () => {
        if (nextTitle && nextTitle !== currentNode.title) {
          await controller.run(renameNodeEntry(file.domain, id, nextTitle));
        }
        if (nextNote !== currentNote) {
          const latest = controller.getSnapshot().file.domain;
          await controller.run(setNodeNoteEntry(latest, id, nextNote));
        }
      });
    },
    [controller, file, guard],
  );

  const handleResizeBox = useCallback(
    (id: string, width: number, height: number) => {
      if (!controller || !file) return;
      guard(() => controller.run(setNodeSizeEntry(file, id, { width, height })));
    },
    [controller, file, guard],
  );

  const handleResizeScale = useCallback(
    (id: string, nextScale: number, kind: 'node' | 'branch' = 'node') => {
      if (!controller || !file) return;
      guard(() =>
        controller.run(
          kind === 'branch'
            ? setBranchScaleEntry(file, id, nextScale)
            : setNodeScaleEntry(file, id, nextScale),
        ),
      );
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
        const saved =
          kind === 'branch'
            ? current.presentation.branchScales[id]
            : current.presentation.nodeScales?.[id];
        if ((saved ?? 1) !== value) {
          await controller.run(
            kind === 'branch'
              ? setBranchScaleEntry(current, id, value)
              : setNodeScaleEntry(current, id, value, true),
          );
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

    const flowNodes: CardNode[] = graph.nodes.map((visual) => {
      const node = nodeMap.get(visual.id)!;
      const hasChildren = (childHierarchyMap.get(visual.id) ?? []).length > 0 || visual.collapsed;
      return {
        id: visual.id,
        type: 'card',
        position: visual.position,
        style: { width: visual.size.width, height: visual.size.height },
        sourcePosition: graph.direction === 'horizontal' ? Position.Right : Position.Bottom,
        targetPosition: graph.direction === 'horizontal' ? Position.Left : Position.Top,
        data: {
          title: node.title,
          note: getNodeNote(file.domain, node.id),
          tags: node.tags,
          taskTotal: visual.taskTotal,
          taskDone: visual.taskDone,
          relationCount: counts[node.id] ?? 0,
          highlighted: highlighted.has(node.id),
          dimmed: highlighted.size > 0 && !highlighted.has(node.id),
          archived: node.archived,
          direction: graph.direction,
          scale: visual.scale,
          startAt: visual.startAt,
          locked: locked.has(node.id),
          collapsed: visual.collapsed,
          collapsedCount: visual.collapsedCount,
          externalConnectionCount: visual.externalConnectionCount,
          lod: visual.lod,
          accentColor: visual.branchColor ?? '#475569',
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
          onCommitEdit: handleCommitEdit,
          onCancelEdit: handleCancelEdit,
          onResizeBox: handleResizeBox,
          onResizeScale: handleResizeScale,
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
        const edgeColor = edge.color ?? (edge.type === 'hierarchy' ? '#64748b' : '#dc2626');
        const selected = selectedEdgeId === edge.id;
        const original =
          edge.originalEdgeIds.length === 1
            ? originalEdges.get(edge.originalEdgeIds[0])
            : undefined;
        const direct =
          original && original.fromNodeId === edge.sourceId && original.toNodeId === edge.targetId;
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
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: selected ? '#2563eb' : isHighlighted ? '#ea580c' : edgeColor,
          },
          data: {
            kind: edge.type,
            highlighted: isHighlighted,
            dimmed: hasHighlight && !isHighlighted,
            color: edgeColor,
            aggregatedCount: edge.aggregatedCount,
            note: direct ? original.note : undefined,
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
    selectedEdgeId,
    cutBranchId,
    readOnly,
    resizeMode,
    handleStartEdit,
    handleCommitEdit,
    handleCancelEdit,
    handleResizeBox,
    handleResizeScale,
    keybindings,
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
        return prior?.measured &&
          prior.style?.width === node.style?.width &&
          prior.style?.height === node.style?.height
          ? { ...node, measured: prior.measured }
          : node;
      });
    });
  }, [derived.flowNodes]);

  const onNodesChange = useCallback((changes: NodeChange<CardNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onSelectionChange = useCallback(({ nodes: selected }: { nodes: CardNode[] }) => {
    const next = selected.map((item) => item.id);
    setSelectedNodeIds((previous) =>
      previous.length === next.length && previous.every((id, index) => id === next[index])
        ? previous
        : next,
    );
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
      if (showInspector) setInspectorOverride(true);
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
        }
      });
    },
    [controller, file, guard],
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

  const addRandomBranchNode = useCallback(
    (screenPos?: { x: number; y: number }): void => {
      if (!file || !controller) return;
      let initialPos: { x: number; y: number };
      if (screenPos && flowApiRef.current?.screenToFlowPosition) {
        const flowPos = flowApiRef.current.screenToFlowPosition(screenPos);
        initialPos = {
          x: Math.round(flowPos.x + (Math.random() - 0.5) * 40),
          y: Math.round(flowPos.y + (Math.random() - 0.5) * 40),
        };
      } else if (flowApiRef.current?.getViewport) {
        const vp = flowApiRef.current.getViewport();
        const centerX = -vp.x / vp.zoom + (window.innerWidth * 0.45) / vp.zoom;
        const centerY = -vp.y / vp.zoom + (window.innerHeight * 0.45) / vp.zoom;
        initialPos = {
          x: Math.round(centerX + (Math.random() - 0.5) * 360),
          y: Math.round(centerY + (Math.random() - 0.5) * 260),
        };
      } else {
        initialPos = {
          x: Math.round(150 + Math.random() * 300),
          y: Math.round(150 + Math.random() * 300),
        };
      }

      const id = newNodeId();
      const count = file.domain.nodes.length + 1;
      guard(async () => {
        await controller.run(
          createNodeEntry(
            id,
            `独立分支 ${count}`,
            null,
            makeId('e_'),
            file.presentation,
            initialPos,
            layoutDirection,
          ),
        );
        if (controller.getSnapshot().error) return;
        setSelectedNodeIds([id]);
        setFocusNodeId(id);
      });
    },
    [controller, file, guard, layoutDirection],
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
        if (activeTabId === tabId) {
          const nextActive = nextTabs[nextTabs.length - 1];
          setActiveTabId(nextActive.id);
        }
        return nextTabs;
      });
    },
    [activeTabId],
  );

  function deleteNode(): void {
    if (!file || !selectedNodeId) return;
    if (selectedNodeId === file.domain.project.rootNodeId) {
      setUiError('根节点不可删除');
      return;
    }
    guard(() => controller!.run(deleteSubtreeEntry(file.domain, selectedNodeId)));
    setSelectedNodeId(null);
  }

  function createSpine(): void {
    if (!file) return;
    const target = selectedNodeId ?? file.domain.project.rootNodeId;
    const nodeIds = pathToRoot(file.domain.nodes, file.domain.edges, target);
    const id = makeId('spn_');
    guard(async () => {
      await controller!.run(createSpineEntry(id, `主干 ${file.domain.spines.length + 1}`, nodeIds));
      setHighlightSpineIds((current) => (current.includes(id) ? current : [...current, id]));
    });
  }

  function exportSvgFile(): void {
    if (!file) return;
    const result = exportSvg({
      nodes: file.domain.nodes,
      edges: file.domain.edges,
      positions: derived.graph?.positions ?? {},
      graph: derived.graph ?? undefined,
      tasks: file.domain.tasks,
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
    const current = controller?.getSnapshot().file;
    if (!current) return;
    download(
      `${current.projectId}${FILE_SUFFIX.project}`,
      `${JSON.stringify(current, null, 2)}\n`,
      'application/json',
    );
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
            (tab) => tab.projectId === opened.file.projectId,
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
    },
    [controller, file, readOnly],
  );

  const moveBranch = useCallback(
    (id: string, parentId: string | null) => {
      if (!controller || readOnly) return;
      guard(async () => {
        const edit = reparentBranchEntry(
          controller.getSnapshot().file,
          id,
          parentId,
          layoutStrategy,
        );
        if (!edit) return;
        await controller.run(edit);
        if (controller.getSnapshot().error) return;
        setSelectedNodeId(id);
        setSelectedEdgeId(null);
      });
    },
    [controller, guard, layoutStrategy, readOnly, setSelectedNodeId],
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
        await controller.run(removeEdgeEntry(controller.getSnapshot().file.domain, edge.id));
        if (!controller.getSnapshot().error) setSelectedEdgeId(null);
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

  function selectConnection(id: string): void {
    setSelectedEdgeId(id);
    setSelectedNodeId(null);
    setEditingNodeId(null);
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

  function reconnectConnection(flowEdge: FlowEdge, connection: Connection): void {
    if (!controller || readOnly) return;
    const originals = originalConnections(
      derived.graph?.edges.find((item) => item.id === flowEdge.id),
    );
    if (originals.length !== 1) return;
    const edge = originals[0];
    if (edge.fromNodeId === connection.source && edge.toNodeId === connection.target) return;
    if (edge.type === 'hierarchy') {
      if (edge.toNodeId === connection.target) moveBranch(edge.toNodeId, connection.source);
      return;
    }
    guard(async () => {
      await controller.run(
        reconnectEdgeEntry(
          controller.getSnapshot().file.domain,
          edge.id,
          connection.source,
          connection.target,
        ),
      );
      if (!controller.getSnapshot().error) setSelectedEdgeId(null);
    });
  }

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!controller || readOnly || !file) return;
      if (!connection.source || !connection.target) return;
      if (connection.source === connection.target) return;

      // 避免重复创建已存在的非层级关联
      const alreadyExists = file.domain.edges.some(
        (edge) =>
          edge.fromNodeId === connection.source &&
          edge.toNodeId === connection.target &&
          edge.type !== 'hierarchy',
      );
      if (alreadyExists) return;

      guard(async () => {
        const edgeId = makeId('e_');
        await controller.run(
          addEdgeEntry({
            id: edgeId,
            type: 'dependency',
            fromNodeId: connection.source,
            toNodeId: connection.target,
          }),
        );
        if (!controller.getSnapshot().error) {
          if (!showRelations) setShowRelations(true);
          setSelectedEdgeId(edgeId);
        }
      });
    },
    [controller, file, guard, readOnly, showRelations],
  );

  function revealConnection(edge: Edge): void {
    guard(async () => {
      const latest = controller!.getSnapshot().file;
      const paths = [edge.fromNodeId, edge.toNodeId].flatMap((id) =>
        pathToRoot(latest.domain.nodes, latest.domain.edges, id).slice(0, -1),
      );
      const collapsed = latest.presentation.collapsedByDefault.filter((id) => paths.includes(id));
      if (collapsed.length) {
        await controller!.run(setCollapsedNodesEntry(latest, collapsed, false));
        if (controller!.getSnapshot().error) return;
      }
      locateNode(edge.toNodeId);
    });
  }

  const selectedVisualEdge =
    selectedEdgeId && derived.flowEdges.some((edge) => edge.id === selectedEdgeId)
      ? derived.graph?.edges.find((edge) => edge.id === selectedEdgeId)
      : undefined;
  const selectedOriginalEdge =
    selectedVisualEdge &&
    file?.domain.edges.find(
      (edge) =>
        selectedVisualEdge?.originalEdgeIds.length === 1 &&
        selectedVisualEdge.originalEdgeIds[0] === edge.id &&
        selectedVisualEdge.sourceId === edge.fromNodeId &&
        selectedVisualEdge.targetId === edge.toNodeId,
    );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const isEditing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (
        !event.defaultPrevented &&
        !isEditing &&
        !settingsOpen &&
        isEventMatchingKeybinding(event, keybindings.saveBranch)
      ) {
        event.preventDefault();
        exportJson();
        return;
      }
      if (event.defaultPrevented || isEditing) return;
      if (event.key === 'Escape') {
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        setContextMenu(null);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setBranchClipboard(null);
        setEditingEdge(null);
        return;
      }
      if (projectView !== 'canvas' || target?.closest('.wst-project-view-switch')) return;

      if (!readOnly && viewMode === '2d' && canvasRef.current?.contains(target)) {
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

      // 3. 随机位置开启新分支（默认 r，可自定义）
      if (
        viewMode === '2d' &&
        isEventMatchingKeybinding(event, keybindings.addRandomBranch) &&
        file
      ) {
        event.preventDefault();
        addRandomBranchNode();
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
    guard,
    selectedNodeId,
    addChildWithInheritedStyle,
    addRandomBranchNode,
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
    viewMode,
  ]);

  function resetDemo(): void {
    if (!file || !controller) return;
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
      className="wst-app"
      data-testid="phase1-root"
      onDragEnter={(event) => handleFileDrag(event, 1)}
      onDragLeave={(event) => handleFileDrag(event, -1)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        fileDragDepth.current = 0;
        setFileDragOver(false);
        openFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {fileDragOver && (
        <div className="wst-file-drop" role="status">
          松开以打开分支文件
        </div>
      )}
      <div className="wst-tab-bar" role="tablist" aria-label="打开的分支文件">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={`wst-tab-item ${tab.id === activeTabId ? 'is-active' : ''}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span className="wst-tab-title" title={`${tab.title} (${tab.branchName})`}>
              {tab.title}
            </span>
            <span className="wst-tab-branch-badge">{tab.branchName}</span>
            {tab.controller.isReadOnly && <span className="wst-tab-branch-badge">只读预览</span>}
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
      </div>
      <WorkspaceToolbar
        file={file}
        readOnly={readOnly}
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
        onAddRandomBranch={() => addRandomBranchNode()}
        onDeleteNode={deleteNode}
        onUndo={() => guard(() => controller.undo())}
        onRedo={() => guard(() => controller.redo())}
        onProjectView={(view) => {
          setContextMenu(null);
          setSelectedEdgeId(null);
          setEditingEdge(null);
          setProjectView(view);
        }}
        onViewMode={(mode) => {
          setSelectedEdgeId(null);
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
        onCreateSpine={createSpine}
        onToggleSpine={(id) =>
          setHighlightSpineIds((current) =>
            current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
          )
        }
        onClearSpines={() => setHighlightSpineIds([])}
        onToggleInspector={() => setInspectorOverride(!inspectorOpen)}
        onImport={() => importRef.current?.click()}
        onExportJson={exportJson}
        onExportSvg={exportSvgFile}
        onResetDemo={resetDemo}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <input ref={importRef} type="file" accept=".json" multiple hidden onChange={importJson} />

      <div className="wst-body" onClick={() => setContextMenu(null)}>
        {projectView === 'canvas' && layoutStrategy === 'date-constrained' && (
          <DateDirectory
            key={`dates-${activeTabId}`}
            nodes={file.domain.nodes}
            selectedId={selectedNodeId}
            compact={compactWorkspace}
            onLocate={(id) => locateProjectNode(id, false)}
          />
        )}
        <main
          className="wst-canvas"
          ref={canvasRef}
          tabIndex={-1}
          aria-label="项目画布"
          inert={projectView === 'todos'}
        >
          {viewMode === '3d' && derived.graph ? (
            <Suspense fallback={<main className="wst-loading">正在加载三维渲染器…</main>}>
              <ThreeCanvas
                graph={derived.graph}
                nodes={file.domain.nodes}
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
              onSelectionChange={onSelectionChange}
              onNodeClick={() => {
                setSelectedEdgeId(null);
                setEditingEdge(null);
                canvasRef.current?.focus({ preventScroll: true });
              }}
              onPaneClick={() => {
                canvasRef.current?.focus({ preventScroll: true });
                setSelectedNodeIds([]);
                setSelectedEdgeId(null);
                setEditingEdge(null);
                setEditingNodeId(null);
                setContextMenu(null);
              }}
              onNodeContextMenu={(event, node) => {
                event.preventDefault();
                if (readOnly) return;
                setSelectedEdgeId(null);
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
              onPaneContextMenu={(event) => {
                event.preventDefault();
                if (readOnly) return;
                setContextMenu({ x: event.clientX, y: event.clientY, kind: 'pane' });
              }}
              onEdgeClick={(_, edge) => {
                selectConnection(edge.id);
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
                selectConnection(edge.id);
                setContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                  kind: 'edge',
                  targetId: edge.id,
                });
              }}
              onReconnect={reconnectConnection}
              onConnect={handleConnect}
              connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 2, strokeDasharray: '5 5' }}
              connectionMode={ConnectionMode.Loose}
              connectionRadius={24}
              connectOnClick={false}
              onNodeDragStart={(_, node) =>
                controller.dragBegin(node.id, node.position, layoutDirection)
              }
              onNodeDrag={(_, node) => controller.dragMove(node.id, node.position, layoutDirection)}
              onNodeDragStop={() => void controller.dragEnd(layoutDirection, layoutStrategy)}
              nodesConnectable={!readOnly}
              nodesDraggable={!readOnly}
              deleteKeyCode={null}
              selectionOnDrag
              selectionMode={SelectionMode.Partial}
              panOnDrag={[1, 2]}
              multiSelectionKeyCode={['Shift', 'Control', 'Meta']}
              fitView
              fitViewOptions={{ padding: FIT_PADDING[layoutDirection] }}
              minZoom={0.1}
              maxZoom={2.5}
              proOptions={{ hideAttribution: true }}
            >
              <FlowViewportController
                fitTrigger={fitTrigger}
                focusNodeId={focusNodeId}
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
              <Controls />
              <MiniMap pannable zoomable style={{ width: 150, height: 108 }} />
            </ReactFlow>
          )}
          <WorkspacePopover label="操作指南" icon="help" align="start" className="wst-view-help">
            {() => (
              <>
                <div className="wst-popover-heading">操作指南</div>
                <ul className="wst-help-list">
                  {viewMode === '3d' ? (
                    <>
                      <li>左键拖动旋转，右键拖动平移</li>
                      <li>滚轮缩放，点击选中节点</li>
                    </>
                  ) : (
                    <>
                      <li>左键拖动框选，中键或右键平移</li>
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
                        <kbd>{keybindings.addRandomBranch}</kbd> 随机新分支，
                        <kbd>{keybindings.fitView}</kbd> 适应视图
                      </li>
                    </>
                  )}
                </ul>
              </>
            )}
          </WorkspacePopover>
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
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onClick={(event) => event.stopPropagation()}
            >
              {contextMenu.kind === 'node' && contextMenu.targetId && (
                <>
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
                        guard(() => controller.run(deleteSubtreeEntry(file.domain, targetId)));
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
                      addRandomBranchNode({ x: contextMenu.x, y: contextMenu.y });
                      setContextMenu(null);
                    }}
                  >
                    🎲 随机位置开启新分支 (R)
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
          selectedCount={selectedNodeIds.length}
          hiddenRelations={selectedNode ? (derived.counts[selectedNode.id] ?? 0) : 0}
          direction={layoutDirection}
          visibleNodeIds={visibleNodeIds}
          controller={controller}
          guard={guard}
          onScalePreview={previewInspectorScale}
          onScaleApply={applyInspectorScale}
          onClose={() => {
            setInspectorOverride(false);
            inspectorToggleRef.current?.focus();
          }}
          onLocate={locateNode}
          onDelete={
            !readOnly && selectedNode?.id !== file.domain.project.rootNodeId
              ? deleteNode
              : undefined
          }
          onEditOnCanvas={
            !readOnly && viewMode === '2d'
              ? (id) => {
                  if (compactWorkspace) setInspectorOverride(false);
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
          onSave={async (source, draft) => {
            setUiError(null);
            await controller.run(saveTodoEntry(controller.getSnapshot().file, source, draft));
            const error = controller.getSnapshot().error;
            if (error) throw new Error(error);
          }}
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
        {(uiError || snapshot.error) && (
          <span className="wst-error" role="alert">
            {uiError ?? snapshot.error}
          </span>
        )}
      </footer>

      <SettingsModal
        open={settingsOpen}
        keybindings={keybindings}
        onClose={() => setSettingsOpen(false)}
        onChangeKeybindings={setKeybindings}
      />
    </div>
  );
}
