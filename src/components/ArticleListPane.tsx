import { Show } from 'solid-js';
import { GripVertical } from 'lucide-solid';
import { useApp } from '../state';
import { River } from './River';
import {
  ARTICLE_LIST_WIDTH_MAX,
  ARTICLE_LIST_WIDTH_MIN,
} from '../db/types';

export function ArticleListPane() {
  const ctx = useApp();
  let resizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  const width = () => ctx.state.articleListWidth;
  const clampWidth = (value: number) => Math.min(ARTICLE_LIST_WIDTH_MAX, Math.max(ARTICLE_LIST_WIDTH_MIN, value));
  const saveWidth = () => void ctx.saveSettingsPatch({
    articleListWidth: width(),
    articleListWidthCustomized: true,
  });

  const startResize = (event: PointerEvent) => {
    event.preventDefault();
    resizing = true;
    resizeStartX = event.clientX;
    resizeStartWidth = width();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const resize = (event: PointerEvent) => {
    if (!resizing) return;
    ctx.setState({
      articleListWidth: clampWidth(resizeStartWidth + event.clientX - resizeStartX),
      articleListWidthCustomized: true,
    });
  };

  const finishResize = (event: PointerEvent) => {
    if (!resizing) return;
    resizing = false;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    saveWidth();
  };

  const resizeWithKeyboard = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 32 : 8;
    let next = width();
    if (event.key === 'ArrowLeft') next -= step;
    else if (event.key === 'ArrowRight') next += step;
    else if (event.key === 'Home') next = ARTICLE_LIST_WIDTH_MIN;
    else if (event.key === 'End') next = ARTICLE_LIST_WIDTH_MAX;
    else return;
    event.preventDefault();
    ctx.setState({ articleListWidth: clampWidth(next), articleListWidthCustomized: true });
    saveWidth();
  };

  return (
    <div class="article-list-pane">
      <River />
      <Show when={ctx.state.view === 'reading'}>
        <div
          class="article-list-resizer desktop-only"
          role="separator"
          aria-label="Resize article list"
          aria-controls="article-list"
          aria-orientation="vertical"
          aria-valuemin={ARTICLE_LIST_WIDTH_MIN}
          aria-valuemax={ARTICLE_LIST_WIDTH_MAX}
          aria-valuenow={width()}
          tabIndex={0}
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={resizeWithKeyboard}
        >
          <GripVertical size={14} aria-hidden="true" />
        </div>
      </Show>
    </div>
  );
}
