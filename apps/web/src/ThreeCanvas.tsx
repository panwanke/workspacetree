import {
  projectVisualNode,
  visualEdgeAnchors,
  type VisibleEdgeTypes,
  type VisualGraph,
  type VisualNode,
} from '@workspacetree/layout';
import type { Node } from '@workspacetree/schema';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface ThreeCanvasProps {
  graph: VisualGraph;
  nodes: readonly Node[];
  selectedNodeId: string | null;
  visibleEdgeTypes: VisibleEdgeTypes;
  fitTrigger: number;
  focusNodeId: string | null;
  onFocused: () => void;
  highlightNodeKey: string;
  highlightEdgeKey: string;
  onSelect: (nodeId: string | null) => void;
  onError: (message: string) => void;
}

function labelTexture(node: VisualNode, domain: Node): THREE.CanvasTexture {
  const { title, archived, tags } = domain;
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建节点文字画布');
  context.fillStyle = node.collapsed ? '#eff6ff' : archived ? '#f1f5f9' : '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#0f172a';
  context.font = '600 42px system-ui, sans-serif';
  context.textBaseline = 'top';
  context.fillText(title.length > 24 ? `${title.slice(0, 23)}…` : title, 32, 28, 704);
  context.fillStyle = '#64748b';
  context.font = '28px system-ui, sans-serif';
  const meta = node.collapsed
    ? `${node.collapsedCount} nodes · ${node.taskDone}/${node.taskTotal} tasks · ${node.externalConnectionCount} links`
    : node.lod === 'summary'
      ? `LOD summary · tasks ${node.taskDone}/${node.taskTotal}`
      : `${node.startAt ?? '未设日期'} · tasks ${node.taskDone}/${node.taskTotal}`;
  context.fillText(meta, 32, 112, 704);
  if (tags?.length) {
    const unique = [...new Set(tags)];
    const visible = unique.slice(0, 2).map((tag) => '#' + tag);
    if (unique.length > 2) visible.push('+' + (unique.length - 2));
    context.fillStyle = '#0e604f';
    context.fillText(visible.join('  '), 32, 170, 704);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Three.js 仅负责渲染；所有位置、尺寸、折叠和连线均来自 VisualGraph。 */
export default function ThreeCanvas({
  graph,
  nodes,
  selectedNodeId,
  visibleEdgeTypes,
  fitTrigger,
  focusNodeId,
  onFocused,
  highlightNodeKey,
  highlightEdgeKey,
  onSelect,
  onError,
}: ThreeCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const materialsRef = useRef(new Map<string, THREE.MeshStandardMaterial>());
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selectedNodeId);
  const frameView = useRef<((id?: string) => void) | null>(null);
  const errorRef = useRef(onError);
  selectRef.current = onSelect;
  selectedRef.current = selectedNodeId;
  errorRef.current = onError;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const highlightedNodes = new Set(highlightNodeKey ? highlightNodeKey.split('|') : []);
    const highlightedEdges = new Set(highlightEdgeKey ? highlightEdgeKey.split('|') : []);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      errorRef.current('当前浏览器无法创建 WebGL 上下文，已回退到二维视图。');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#f8fafc');
    renderer.domElement.dataset.testid = 'three-canvas';
    renderer.domElement.setAttribute(
      'aria-label',
      '三维项目画布，拖动旋转，滚轮缩放，点击节点选中',
    );
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f8fafc');
    scene.fog = new THREE.Fog('#f8fafc', 2600, 7200);
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 15000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 180;
    controls.maxDistance = 6500;

    scene.add(new THREE.HemisphereLight('#ffffff', '#cbd5e1', 2.4));
    const directional = new THREE.DirectionalLight('#ffffff', 2.2);
    directional.position.set(500, 1000, 700);
    scene.add(directional);
    const grid = new THREE.GridHelper(7000, 70, '#cbd5e1', '#e2e8f0');
    grid.position.y = -90;
    scene.add(grid);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const pickable: THREE.Mesh[] = [];
    for (const visual of graph.nodes) {
      const domain = nodeById.get(visual.id);
      if (!domain) continue;
      const point = projectVisualNode(visual);
      const selected = visual.id === selectedRef.current;
      const geometry = new THREE.BoxGeometry(visual.size.width, 18, visual.size.height);
      const material = new THREE.MeshStandardMaterial({
        color: selected
          ? '#fdba74'
          : highlightedNodes.has(visual.id)
            ? '#fed7aa'
            : visual.collapsed
              ? '#93c5fd'
              : domain.archived
                ? '#cbd5e1'
                : '#ffffff',
        roughness: 0.72,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(geometry, material);
      materialsRef.current.set(visual.id, material);
      mesh.position.set(point.x, point.y, point.z);
      mesh.userData.nodeId = visual.id;
      scene.add(mesh);
      pickable.push(mesh);

      const texture = labelTexture(visual, domain);
      const labelMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const label = new THREE.Sprite(labelMaterial);
      label.scale.set(visual.size.width, visual.size.width / 3, 1);
      label.position.set(point.x, point.y + 24, point.z);
      scene.add(label);
    }

    for (const edge of graph.edges) {
      if (!visibleEdgeTypes.includes(edge.type)) continue;
      const source = graph.nodeById[edge.sourceId];
      const target = graph.nodeById[edge.targetId];
      if (!source || !target) continue;
      const anchors = visualEdgeAnchors(source, target, graph.direction);
      const start = new THREE.Vector3(
        anchors.source.x,
        projectVisualNode(source).y + 2,
        anchors.source.y,
      );
      const end = new THREE.Vector3(
        anchors.target.x,
        projectVisualNode(target).y + 2,
        anchors.target.y,
      );
      const middle = start.clone().lerp(end, 0.5);
      middle.y += 45 + edge.aggregatedCount * 4;
      const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
      const material = new THREE.LineBasicMaterial({
        color: edge.originalEdgeIds.some((id) => highlightedEdges.has(id))
          ? '#ea580c'
          : edge.type === 'hierarchy'
            ? '#64748b'
            : '#c026d3',
        transparent: true,
        opacity: 0.86,
      });
      scene.add(new THREE.Line(geometry, material));
    }

    const center = new THREE.Vector3(
      (graph.bounds.minX + graph.bounds.maxX) / 2,
      0,
      (graph.bounds.minY + graph.bounds.maxY) / 2,
    );
    const span = Math.max(
      500,
      graph.bounds.maxX - graph.bounds.minX,
      graph.bounds.maxY - graph.bounds.minY,
    );
    camera.position.copy(center).add(new THREE.Vector3(span * 0.7, span * 0.85, span * 0.9));
    controls.target.copy(center);
    controls.update();
    controls.saveState();
    frameView.current = (id) => {
      if (!id) {
        controls.reset();
        return;
      }
      const node = graph.nodeById[id];
      if (!node) return;
      const point = projectVisualNode(node);
      const distance = Math.max(220, node.size.width, node.size.height) * 1.4;
      controls.target.set(point.x, point.y, point.z);
      camera.position
        .copy(controls.target)
        .add(new THREE.Vector3(distance * 0.6, distance, distance));
      controls.update();
    };

    const resize = (): void => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent): void => {
      pointerDown = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (
        !pointerDown ||
        Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5
      ) {
        pointerDown = null;
        return;
      }
      pointerDown = null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickable, false)[0];
      selectRef.current(
        typeof hit?.object.userData.nodeId === 'string' ? hit.object.userData.nodeId : null,
      );
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let frame = 0;
    const render = (): void => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      frameView.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      materialsRef.current.clear();
    };
  }, [graph, nodes, highlightNodeKey, highlightEdgeKey, visibleEdgeTypes]);

  useEffect(() => {
    if (fitTrigger) frameView.current?.();
  }, [fitTrigger]);

  useEffect(() => {
    if (!focusNodeId || !frameView.current) return;
    frameView.current(focusNodeId);
    onFocused();
  }, [focusNodeId, onFocused]);

  useEffect(() => {
    const domainById = new Map(nodes.map((node) => [node.id, node]));
    const highlighted = new Set(highlightNodeKey ? highlightNodeKey.split('|') : []);
    for (const [id, material] of materialsRef.current) {
      const visual = graph.nodeById[id];
      const domain = domainById.get(id);
      material.color.set(
        id === selectedNodeId
          ? '#fdba74'
          : highlighted.has(id)
            ? '#fed7aa'
            : visual?.collapsed
              ? '#93c5fd'
              : domain?.archived
                ? '#cbd5e1'
                : '#ffffff',
      );
    }
  }, [graph, nodes, selectedNodeId, highlightNodeKey]);

  return <div ref={hostRef} className="wst-three-host" data-testid="three-view" />;
}
