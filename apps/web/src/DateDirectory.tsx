import type { Node } from '@workspacetree/schema';
import { useMemo, useState } from 'react';

export default function DateDirectory({
  nodes,
  selectedId,
  compact,
  onLocate,
}: {
  nodes: readonly Node[];
  selectedId: string | null;
  compact: boolean;
  onLocate: (id: string) => void;
}) {
  const [open, setOpen] = useState(!compact);
  const groups = useMemo(() => {
    const dated = nodes.filter((node) => node.startAt);
    dated.sort(
      (a, b) =>
        a.startAt!.localeCompare(b.startAt!) ||
        a.title.localeCompare(b.title, 'zh-CN') ||
        a.id.localeCompare(b.id),
    );
    const byDate = new Map<string, Node[]>();
    for (const node of dated) {
      const date = node.startAt!;
      const group = byDate.get(date);
      if (group) group.push(node);
      else byDate.set(date, [node]);
    }
    return [...byDate];
  }, [nodes]);

  function jump(node: Node) {
    onLocate(node.id);
    if (compact) setOpen(false);
  }

  return (
    <nav className="wst-date-directory" aria-label="日期跳转目录" data-open={open}>
      <button
        type="button"
        className="wst-tool wst-date-directory-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        日期目录
      </button>
      {open && (
        <div className="wst-date-directory-list">
          {!groups.length && <p className="wst-muted">暂无带日期的节点</p>}
          {groups.map(([date, items]) =>
            items.length === 1 ? (
              <button
                key={date}
                type="button"
                className="wst-date-directory-entry"
                aria-current={items[0].id === selectedId ? 'true' : undefined}
                onClick={() => jump(items[0])}
              >
                <time dateTime={date}>{date}</time>
                <span title={items[0].title}>{items[0].title || '未命名节点'}</span>
              </button>
            ) : (
              <details key={date}>
                <summary>
                  <time dateTime={date}>{date}</time> · {items.length}
                </summary>
                {items.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className="wst-date-directory-entry"
                    aria-current={node.id === selectedId ? 'true' : undefined}
                    onClick={() => jump(node)}
                  >
                    <span title={node.title}>{node.title || '未命名节点'}</span>
                  </button>
                ))}
              </details>
            ),
          )}
        </div>
      )}
    </nav>
  );
}
