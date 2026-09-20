import type { Item } from './db/types';

interface ReaderNavigationContext {
  state: { focusedIndex: number };
  items: () => Item[];
  jumpTo: (offset: number) => void;
  openItem: (item: Item, replace?: boolean) => Promise<void>;
}

export function navigateReaderByOffset(ctx: ReaderNavigationContext, offset: number): void {
  ctx.jumpTo(offset);
  const item = ctx.items()[ctx.state.focusedIndex];
  if (item) void ctx.openItem(item, true);
}
