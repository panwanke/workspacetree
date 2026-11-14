import type { Edge, Node, Spine } from '@workspacetree/schema';
import { resolveChildrenHierarchyRoles, type ChildrenHierarchyRoles } from './roles.js';
import type { buildHierarchy } from './tree.js';
import {
  DEFAULT_LAYOUT_OPTIONS,
  type DateAnchor,
  type LayoutDirection,
  type Point,
  type Size,
} from './types.js';

interface Span {
  left: number;
  right: number;
}

interface Profile extends Span {
  bands: Map<number, Span>;
}

const DAY_MS = 86_400_000;
const DATE_TOLERANCE_DAYS = 7;

/** Reserve separate horizontal space only where the vertical extents of two branches meet. */
function clearance(outer: Profile, inner: Profile, gap: number): { left: number; right: number } {
  let left = 0;
  let right = 0;
  for (const [band, span] of outer.bands) {
    const obstacle = inner.bands.get(band);
    if (!obstacle) continue;
    left = Math.max(left, span.right + gap - obstacle.left);
    right = Math.max(right, obstacle.right + gap - span.left);
  }
  return { left, right };
}

function mergeProfile(target: Profile, branch: Profile, offset: number): void {
  target.left = Math.min(target.left, branch.left + offset);
  target.right = Math.max(target.right, branch.right + offset);
  for (const [band, span] of branch.bands) {
    const left = span.left + offset;
    const right = span.right + offset;
    const existing = target.bands.get(band);
    target.bands.set(
      band,
      existing
        ? { left: Math.min(left, existing.left), right: Math.max(right, existing.right) }
        : { left, right },
    );
  }
}

export function placeStructure(
  nodes: readonly Node[],
  { children, roots }: ReturnType<typeof buildHierarchy>,
  rootId: string,
  sizes: Readonly<Record<string, Size>>,
  direction: LayoutDirection,
  options: typeof DEFAULT_LAYOUT_OPTIONS,
  spines: readonly Spine[],
  mode: 'structure' | 'date-constrained' | 'date-priority',
  allNodes: readonly Node[] = nodes,
  edges: readonly Edge[] = [],
): { positions: Record<string, Point>; order: string[]; dateAnchors: DateAnchor[] } {
  const constrainDates = mode === 'date-constrained';
  const horizontal = direction === 'horizontal';
  const mainSize = (id: string) => (horizontal ? sizes[id].width : sizes[id].height);
  const crossSize = (id: string) => (horizontal ? sizes[id].height : sizes[id].width);
  const mainGap = Math.max(16, horizontal ? options.horizontalGap * 0.45 : options.verticalGap);
  const sideGap = Math.max(22, (horizontal ? options.verticalGap : options.horizontalGap) * 0.42);
  const branchGap = Math.max(72, sideGap * 2.5);
  const bandHeight = Math.max(16, mainGap);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const rootsInOrder = roots.filter((id) => byId.has(id)).sort();
  if (rootsInOrder.includes(rootId)) {
    rootsInOrder.splice(rootsInOrder.indexOf(rootId), 1);
    rootsInOrder.unshift(rootId);
  }
  const childrenOf = (id: string) => (children.get(id) ?? []).filter((child) => byId.has(child));
  const order = [...rootsInOrder];
  for (let index = 0; index < order.length; index++) order.push(...childrenOf(order[index]));

  // Prefer a recorded continuation. When paths share a fork, use the longest remaining path.
  const spineRank = new Map<string, number>();
  for (const { nodeIds } of spines) {
    for (let index = 1; index < nodeIds.length; index++) {
      const id = nodeIds[index];
      spineRank.set(id, Math.max(spineRank.get(id) ?? 0, nodeIds.length - index));
    }
  }
  const dates = new Map(nodes.map((node) => [node.id, node.startAt ?? null]));
  const origin = (constrainDates ? allNodes : nodes).reduce(
    (earliest, node) => (node.startAt ? Math.min(earliest, Date.parse(node.startAt)) : earliest),
    Infinity,
  );
  const datePosition = (date: string, extraDays = 0) => {
    const days = (Date.parse(date) - origin) / DAY_MS + extraDays;
    // Give near dates room to separate and compress long gaps in multi-year projects.
    const pixelsPerDay = constrainDates ? (horizontal ? 36 : 23) : 15;
    return pixelsPerDay * (Math.min(days, 45) + 45 * Math.log1p(Math.max(0, days - 45) / 45));
  };
  const depth = new Map<string, number>();
  const orderedChildren = new Map<string, string[]>();
  const earliest = new Map<string, string>();
  if (mode !== 'structure') {
    const datesById = new Map(allNodes.map((node) => [node.id, node.startAt]));
    const allIds = [...roots];
    for (let index = 0; index < allIds.length; index++) {
      for (const child of children.get(allIds[index]) ?? []) allIds.push(child);
    }
    for (let index = allIds.length - 1; index >= 0; index--) {
      const id = allIds[index];
      let first = datesById.get(id);
      if (!first) {
        for (const child of children.get(id) ?? []) {
          const date = earliest.get(child);
          if (date && (!first || date < first)) first = date;
        }
      }
      if (first) earliest.set(id, first);
    }
  }
  const rolesByParent = new Map<string, ChildrenHierarchyRoles>();
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index];
    const kids = childrenOf(id);
    const roles = resolveChildrenHierarchyRoles(id, kids, edges, spines);
    rolesByParent.set(id, roles);

    const sortGroup = (ids: string[]) =>
      [...ids].sort(
        (a, b) =>
          (spineRank.get(b) ?? 0) - (spineRank.get(a) ?? 0) ||
          depth.get(b)! - depth.get(a)! ||
          (dates.get(a) ?? '9999').localeCompare(dates.get(b) ?? '9999') ||
          a.localeCompare(b),
      );

    const group = roles.continuation
      ? [roles.continuation, ...sortGroup(roles.leaves), ...sortGroup(roles.branches)]
      : [...sortGroup(roles.leaves), ...sortGroup(roles.branches)];

    orderedChildren.set(id, group);
    depth.set(id, 1 + (group.length ? Math.max(...group.map((child) => depth.get(child)!)) : 0));
  }
  // Center the first fork with two substantial branches under the common stem.
  let firstFork = rootId;
  while (orderedChildren.get(firstFork)?.length === 1)
    firstFork = orderedChildren.get(firstFork)![0];
  const forkChildren = orderedChildren.get(firstFork) ?? [];
  const forkRoles = rolesByParent.get(firstFork);
  const split =
    forkChildren.filter((id) => depth.get(id)! >= 3).length >= 2 &&
    (!forkRoles?.continuation || forkRoles.branches.length >= 1)
      ? firstFork
      : null;

  const axis = new Map<string, number>();
  const dateAnchors: DateAnchor[] = [];
  const lastDate = new Map<string, string | null>();
  // Locate undated parents immediately before the first dated descendant in their own subtree.
  const beforeDescendant = new Map<string, number>();
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index];
    if (dates.get(id) || !earliest.has(id)) continue;
    const first = earliest.get(id);
    const offsets = orderedChildren
      .get(id)!
      .filter((child) => earliest.get(child) === first)
      .map((child) => beforeDescendant.get(child) ?? 0);
    beforeDescendant.set(id, mainSize(id) + mainGap + Math.max(0, ...offsets));
  }
  for (const id of rootsInOrder) {
    const first = earliest.get(id);
    axis.set(
      id,
      constrainDates && first ? datePosition(first) - (beforeDescendant.get(id) ?? 0) : 0,
    );
    lastDate.set(id, dates.get(id) ?? null);
  }
  for (const id of order) {
    const parentDay = lastDate.get(id);
    const parentRoles = rolesByParent.get(id);
    for (const [index, child] of orderedChildren.get(id)!.entries()) {
      const date = dates.get(child);
      const days =
        date && parentDay ? Math.max(0, (Date.parse(date) - Date.parse(parentDay)) / DAY_MS) : 0;
      const timeGap = Math.min(110, 20 * Math.log1p(days / 4));
      const isContinuation = child === parentRoles?.continuation;
      const leafIdx = parentRoles?.leaves.indexOf(child) ?? -1;
      const stagger = isContinuation
        ? 0
        : leafIdx >= 0
          ? 16 + 18 * leafIdx
          : index > 0
            ? 12 + 9 * Math.log2(index)
            : 0;
      const afterParent = axis.get(id)! + mainSize(id) + mainGap + timeGap;
      const desired = Math.max(afterParent, date ? datePosition(date) : 0) + (date ? 0 : stagger);
      const first = earliest.get(child);
      const undatedAnchor =
        !date && first ? datePosition(first) - beforeDescendant.get(child)! : null;
      axis.set(
        child,
        constrainDates && date
          ? Math.min(desired, datePosition(date, DATE_TOLERANCE_DAYS))
          : constrainDates && undatedAnchor !== null
            ? undatedAnchor
            : desired,
      );
      lastDate.set(child, date ?? parentDay ?? null);
    }
  }
  if (mode === 'date-priority') {
    const bands = new Map<string, { before: string[]; dated: string[]; after: string[] }>();
    for (const id of order) {
      const date = dates.get(id);
      const first = earliest.get(id);
      const key = date ?? first ?? lastDate.get(id) ?? '';
      const band = bands.get(key) ?? { before: [], dated: [], after: [] };
      (date ? band.dated : first || !key ? band.before : band.after).push(id);
      bands.set(key, band);
    }
    let position = 0;
    for (const [date, band] of [...bands].sort(([a], [b]) => a.localeCompare(b))) {
      for (const id of band.before) {
        axis.set(id, position);
        position += mainSize(id) + mainGap;
      }
      if (band.dated.length) {
        for (const id of band.dated) axis.set(id, position);
        const size = Math.max(...band.dated.map(mainSize));
        dateAnchors.push({ date, position: position + size / 2, nodeIds: band.dated });
        position += size + mainGap;
      }
      for (const id of band.after) {
        axis.set(id, position);
        position += mainSize(id) + mainGap;
      }
    }
  }

  const profiles = new Map<string, Profile>();
  const offsets = new Map<string, number>();
  // Compress the band indices so very tall or widely spaced cards never require empty bins.
  const occupiedBoundaries = new Set<number>();
  for (const id of order) {
    const start = axis.get(id)!;
    occupiedBoundaries.add(Math.floor(start / bandHeight));
    occupiedBoundaries.add(Math.floor((start + mainSize(id)) / bandHeight) + 1);
  }
  const bandIndices = new Map(
    [...occupiedBoundaries].sort((a, b) => a - b).map((band, index) => [band, index]),
  );
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index];
    const group = orderedChildren.get(id)!;
    if (group.length === 0) {
      const half = crossSize(id) / 2;
      const start = axis.get(id)!;
      const firstBand = bandIndices.get(Math.floor(start / bandHeight))!;
      const afterLastBand = bandIndices.get(Math.floor((start + mainSize(id)) / bandHeight) + 1)!;
      const card: Profile = { left: -half, right: half, bands: new Map() };
      for (let band = firstBand; band < afterLastBand; band++) {
        card.bands.set(band, card);
      }
      profiles.set(id, card);
      continue;
    }

    const roles = rolesByParent.get(id)!;
    const hasContinuation = roles.continuation !== null;
    const main = hasContinuation ? roles.continuation! : null;
    const sides = hasContinuation ? group.slice(1) : group;

    // Reuse the primary profile instead of copying it at each level of a long chain.
    const profile = (main && profiles.get(main)) || { left: 0, right: 0, bands: new Map() };
    if (main) {
      profiles.delete(main);
      offsets.set(main, 0);
    }

    if (!hasContinuation && sides.length === 1 && roles.branches.includes(sides[0])) {
      const child = sides[0];
      const branch = profiles.get(child)!;
      const gap = branchGap;
      const minimum = Math.max(72, (crossSize(id) + crossSize(child)) / 2 + gap);
      const offset = minimum;
      offsets.set(child, offset);
      mergeProfile(profile, branch, offset);
      profiles.delete(child);
    } else {
      for (const [sideIndex, child] of sides.entries()) {
        const branch = profiles.get(child)!;
        const isBranch = roles.branches.includes(child);
        const gap = isBranch || id === split || depth.get(child)! >= 4 ? branchGap : sideGap;
        const refCross = main ? crossSize(main) : crossSize(id);
        const minimum = Math.max(isBranch ? 72 : 50, (refCross + crossSize(child)) / 2 + gap);
        const required = clearance(branch, profile, gap);
        const right = Math.max(minimum, required.right);
        const left = Math.max(minimum, required.left);
        const growRight = Math.max(0, branch.right + right - profile.right);
        const growLeft = Math.max(0, profile.left - branch.left + left);
        let offset: number;
        if (id === split && sideIndex === 0) {
          offset = right;
        } else if (!isBranch && sideIndex === 0) {
          offset = -left;
        } else if (!isBranch && sideIndex === 1) {
          offset = right;
        } else {
          offset = growRight <= growLeft ? right : -left;
        }
        offsets.set(child, offset);
        mergeProfile(profile, branch, offset);
        profiles.delete(child);
      }
    }
    if (id === split && main && sides.length) {
      const shift = (offsets.get(sides[0]) ?? 0) / 2;
      for (const child of [main, ...sides]) offsets.set(child, (offsets.get(child) ?? 0) - shift);
      // Center the two leading branches around the common parent.
      for (const [band, span] of profile.bands) {
        profile.bands.set(band, { left: span.left - shift, right: span.right - shift });
      }
      profile.left -= shift;
      profile.right -= shift;
    }
    const half = crossSize(id) / 2;
    const start = axis.get(id)!;
    const firstBand = bandIndices.get(Math.floor(start / bandHeight))!;
    const afterLastBand = bandIndices.get(Math.floor((start + mainSize(id)) / bandHeight) + 1)!;
    const card: Profile = { left: -half, right: half, bands: new Map() };
    for (let band = firstBand; band < afterLastBand; band++) {
      card.bands.set(band, card);
    }
    if (mode !== 'structure' && main) {
      // A dated child can be level with or above its parent. Move the children sideways
      // as a group if their existing contour conflicts with the parent's card.
      const { left, right } = clearance(card, profile, sideGap);
      if (left > 0 || right > 0) {
        const shift = left < right ? left : -right;
        for (const child of [main, ...sides]) offsets.set(child, (offsets.get(child) ?? 0) + shift);
        mergeProfile(card, profile, shift);
        profiles.set(id, card);
        continue;
      }
    }
    mergeProfile(profile, card, 0);
    profiles.set(id, profile);
  }

  const centers = new Map<string, number>();
  let right = 0;
  for (const [index, id] of rootsInOrder.entries()) {
    const profile = profiles.get(id)!;
    const center = index === 0 ? 0 : right + branchGap - profile.left;
    centers.set(id, center);
    right = center + profile.right;
  }
  const positions: Record<string, Point> = {};
  for (const id of order) {
    const center = centers.get(id)!;
    const cross = center - crossSize(id) / 2;
    const main = axis.get(id)!;
    positions[id] = horizontal ? { x: main, y: cross } : { x: cross, y: main };
    for (const child of orderedChildren.get(id)!)
      centers.set(child, center + (offsets.get(child) ?? 0));
  }
  return { positions, order, dateAnchors };
}
