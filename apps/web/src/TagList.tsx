export function TagList({
  tags,
  label,
  limit = Infinity,
  onRemove,
}: {
  tags: readonly string[];
  label: string;
  limit?: number;
  onRemove?: (tag: string) => void;
}) {
  const unique = [...new Set(tags)];
  if (unique.length === 0) return null;
  const remaining = unique.slice(limit);

  return (
    <span className="wst-tags" role="group" aria-label={label}>
      {unique.slice(0, limit).map((tag) =>
        onRemove ? (
          <button
            key={tag}
            type="button"
            className="wst-tag"
            aria-label={'移除标签 #' + tag}
            onClick={() => onRemove(tag)}
          >
            <span>#{tag}</span>
            <span aria-hidden="true">×</span>
          </button>
        ) : (
          <span key={tag} className="wst-tag" title={'#' + tag}>
            <span>#{tag}</span>
          </span>
        ),
      )}
      {remaining.length > 0 && (
        <span className="wst-tag" title={remaining.map((tag) => '#' + tag).join('、')}>
          +{remaining.length}
        </span>
      )}
    </span>
  );
}
