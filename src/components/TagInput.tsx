import { createSignal, For, Show } from 'solid-js';
import { normalizeTag } from '../util/tags';

interface TagInputProps {
  allTags: string[];
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput(props: TagInputProps) {
  const [input, setInput] = createSignal('');
  const [focused, setFocused] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const suggestions = () => {
    const q = normalizeTag(input());
    if (!q) return [];
    const existing = new Set(props.value.map(normalizeTag));
    return props.allTags
      .filter((t) => {
        const normalized = normalizeTag(t);
        return normalized !== null && normalized !== q && normalized.startsWith(q);
      })
      .slice(0, 10);
  };

  const addTag = (raw: string) => {
    const tag = normalizeTag(raw);
    if (!tag || tag.length > 64) return;
    const existing = new Set(props.value.map(normalizeTag));
    if (existing.has(tag)) return;
    props.onChange([...props.value, tag]);
    setInput('');
  };

  const removeTag = (idx: number) => {
    props.onChange(props.value.filter((_, i) => i !== idx));
  };

  return (
    <div class="tag-input">
      <div class="tag-chips">
        <For each={props.value}>
          {(tag, idx) => (
            <span class="tag-chip removable">
              {tag}
              <button
                class="tag-chip-remove"
                onClick={() => removeTag(idx())}
                aria-label={`Remove tag ${tag}`}
                type="button"
              >
                ✕
              </button>
            </span>
          )}
        </For>
        <input
          ref={inputRef}
          type="text"
          class="tag-input-field"
          placeholder={props.placeholder ?? 'Add tag…'}
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(input());
            } else if (e.key === 'Backspace' && !input() && props.value.length > 0) {
              removeTag(props.value.length - 1);
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      </div>
      <Show when={focused() && suggestions().length > 0}>
        <div class="tag-suggestions">
          <For each={suggestions()}>
            {(tag) => (
              <button
                class="tag-suggestion"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addTag(tag);
                }}
                type="button"
              >
                {tag}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
