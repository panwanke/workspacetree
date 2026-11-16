import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { OnNodeDrag } from '@xyflow/react';
import type { LayoutDirection, LayoutStrategy } from '@workspacetree/layout';
import type { CardNode } from './CanvasNode';
import type { EditorController } from './editor';
import { alignNodeDrag, type AlignmentGuide, type AlignmentRect } from './node-alignment';

interface DragFrame {
  node: CardNode;
  companions: CardNode[];
  snap: boolean;
}

interface DragSession {
  editor: EditorController;
  direction: LayoutDirection;
  strategy: LayoutStrategy;
  candidates: AlignmentRect[];
  frame?: DragFrame;
}

const NO_GUIDES: AlignmentGuide[] = [];

function nodeRect(node: CardNode): AlignmentRect | undefined {
  const width = node.measured?.width ?? node.style?.width;
  const height = node.measured?.height ?? node.style?.height;
  if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
    return { ...node.position, width, height };
  }
}

export function useCanvasNodeDrag({
  editor,
  direction,
  strategy,
  enabled,
  nodes,
  setNodes,
  getZoom,
}: {
  editor: EditorController | null;
  direction: LayoutDirection;
  strategy: LayoutStrategy;
  enabled: boolean;
  nodes: CardNode[];
  setNodes: Dispatch<SetStateAction<CardNode[]>>;
  getZoom: () => number;
}) {
  const drag = useRef<DragSession | null>(null);
  const [guides, setGuides] = useState(NO_GUIDES);

  const applyFrame = useCallback(
    (snap: boolean, dragging = true) => {
      const session = drag.current;
      const frame = session?.frame;
      if (!session || !frame) return;

      const { node, companions } = frame;
      const rect = snap ? nodeRect(node) : undefined;
      const alignment = rect ? alignNodeDrag(rect, session.candidates, getZoom()) : undefined;
      const position = alignment?.position ?? node.position;
      const dx = position.x - node.position.x;
      const dy = position.y - node.position.y;
      const movedCompanions = companions.map((item) => ({
        id: item.id,
        position: { x: item.position.x + dx, y: item.position.y + dy },
      }));

      if (dragging || snap !== frame.snap) {
        session.editor.dragMove(node.id, position, session.direction, movedCompanions);
      }
      // React Flow emits the raw positions before its drag and drag stop callbacks.
      if (snap || frame.snap) {
        const positions = new Map([
          [node.id, position],
          ...movedCompanions.map((item) => [item.id, item.position] as const),
        ]);
        setNodes((current) =>
          current.map((item) => {
            const at = positions.get(item.id);
            return at ? { ...item, position: at, dragging } : item;
          }),
        );
      }
      frame.snap = snap;
      setGuides(dragging && alignment?.guides.length ? alignment.guides : NO_GUIDES);
    },
    [getZoom, setNodes],
  );

  useEffect(() => {
    const updateModifier = (event: KeyboardEvent) => {
      if (event.key === 'Control' && drag.current?.frame?.snap !== event.ctrlKey) {
        applyFrame(event.ctrlKey);
      }
    };
    const clearModifier = () => {
      if (drag.current?.frame?.snap) applyFrame(false);
    };
    window.addEventListener('keydown', updateModifier);
    window.addEventListener('keyup', updateModifier);
    window.addEventListener('blur', clearModifier);
    return () => {
      window.removeEventListener('keydown', updateModifier);
      window.removeEventListener('keyup', updateModifier);
      window.removeEventListener('blur', clearModifier);
    };
  }, [applyFrame]);

  useEffect(() => {
    drag.current = null;
    setGuides(NO_GUIDES);
  }, [editor, direction, enabled]);

  const onNodeDragStart: OnNodeDrag<CardNode> = (_, node, movingNodes) => {
    if (!editor || !enabled) return;
    const movingIds = new Set([node.id, ...movingNodes.map((item) => item.id)]);
    const candidates = nodes
      .filter((item) => !item.hidden && !movingIds.has(item.id))
      .map(nodeRect)
      .filter((rect) => rect !== undefined);
    drag.current = { editor, direction, strategy, candidates };
    editor.dragBegin(
      node.id,
      node.position,
      direction,
      movingNodes.filter((item) => item.id !== node.id),
    );
  };

  const onNodeDrag: OnNodeDrag<CardNode> = (event, node, movingNodes) => {
    const session = drag.current;
    if (!session) return;
    session.frame = {
      node,
      companions: movingNodes.filter((item) => item.id !== node.id),
      snap: session.frame?.snap ?? false,
    };
    applyFrame(event.ctrlKey);
  };

  const onNodeDragStop: OnNodeDrag<CardNode> = (event) => {
    const session = drag.current;
    if (!session) return;
    applyFrame(event.ctrlKey, false);
    drag.current = null;
    void session.editor.dragEnd(session.direction, session.strategy);
  };

  return { guides, onNodeDragStart, onNodeDrag, onNodeDragStop };
}
