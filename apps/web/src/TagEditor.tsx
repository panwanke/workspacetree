import { TagSchema } from '@workspacetree/schema';
import { useId, useState } from 'react';
import { TagList } from './TagList';
import { WorkspaceIcon } from './WorkspaceIcon';

export function TagEditor({
  label,
  tags = [],
  onChange,
}: {
  label: string;
  tags?: readonly string[];
  onChange: (tags: string[]) => Promise<boolean>;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(next: string[], clearDraft = false) {
    setSaving(true);
    try {
      if ((await onChange(next)) && clearDraft) setDraft('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="wst-tag-editor"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        if (saving || !draft.trim()) return;
        const added = draft
          .trim()
          .split(/[\s,，、]+/)
          .filter(Boolean)
          .map((tag) => tag.replace(/^#/, ''));
        if (added.length === 0 || added.some((tag) => !TagSchema.safeParse(tag).success)) {
          setInvalid(true);
          return;
        }
        const next = [...new Set([...tags, ...added])];
        if (next.length === tags.length) {
          setDraft('');
          return;
        }
        void save(next, true);
      }}
    >
      <TagList
        tags={tags}
        label={label}
        onRemove={
          saving
            ? undefined
            : (tag) => {
                void save(tags.filter((value) => value !== tag));
              }
        }
      />
      <div className="wst-input-action">
        <input
          aria-label={'新增' + label}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          placeholder="例如 #实验 #招募"
          value={draft}
          readOnly={saving}
          onChange={(event) => {
            setDraft(event.target.value);
            setInvalid(false);
          }}
        />
        <button
          type="submit"
          className="wst-tool is-icon"
          title={'添加' + label}
          aria-label={'添加' + label}
          disabled={saving || !draft.trim()}
        >
          <WorkspaceIcon name="plus" />
        </button>
      </div>
      {invalid && (
        <p id={errorId} className="wst-tag-error" role="alert">
          标签可用文字、数字、下划线和连字符。
        </p>
      )}
    </form>
  );
}
