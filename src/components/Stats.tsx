import { ArrowDownUp, ChartNoAxesCombined, CircleQuestionMark, X } from 'lucide-solid';
import { createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { useApp } from '../state';
import { loadStats, sortFeedStats, type StatsSort } from '../stats/service';

const numberFormat = new Intl.NumberFormat();

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function formatRate(value: number | null): string {
  return value == null ? 'Not enough data' : `${Math.round(value * 100)}%`;
}

function formatExpected(value: number | null): string {
  return value == null ? 'Not enough data' : value.toFixed(1);
}

function formatIndex(value: number | null): string {
  return value == null ? 'Not enough data' : `${value.toFixed(1)}x`;
}

export function Stats() {
  const ctx = useApp();
  const [sort, setSort] = createSignal<StatsSort>('readOnce');
  const [definitionsOpen, setDefinitionsOpen] = createSignal(false);
  let helpButton: HTMLButtonElement | undefined;
  let definitionsPanel: HTMLDivElement | undefined;

  const closeDefinitions = () => {
    setDefinitionsOpen(false);
    helpButton?.focus();
  };

  const toggleDefinitions = () => {
    if (definitionsOpen()) {
      closeDefinitions();
      return;
    }
    setDefinitionsOpen(true);
    queueMicrotask(() => {
      if (definitionsOpen()) definitionsPanel?.focus();
    });
  };

  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!definitionsOpen()) return;
      const target = event.target;
      if (target instanceof Node && !definitionsPanel?.contains(target) && !helpButton?.contains(target)) {
        setDefinitionsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && definitionsOpen()) {
        event.preventDefault();
        closeDefinitions();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    });
  });

  const [summary] = createResource(
    () => ctx.hydrated() ? ctx.statsRevision() : undefined,
    () => loadStats(),
  );
  const rows = createMemo(() => sortFeedStats(summary()?.feeds ?? [], sort()));
  const maxVolume = createMemo(() => Math.max(1, ...rows().map((row) => row.totalSeen)));
  const approximate = () => ctx.syncKey() !== null;

  return (
    <main class="stats-view">
      <div class="stats-inner">
        <div class="stats-page-heading">
          <header class="stats-header">
            <div class="stats-kicker"><ChartNoAxesCombined size={16} /> Stats</div>
            <h1>Your reading habits</h1>
            <p>
              See which feeds you come back to most, and how much of what they publish you get through.
              <Show when={!approximate()}>
                {' '}Your stats stay on this device and work offline.
              </Show>
            </p>
          </header>
          <div class="stats-help">
            <button
              ref={helpButton}
              class="stats-help-button"
              type="button"
              aria-label="How these numbers work"
              aria-haspopup="dialog"
              aria-expanded={definitionsOpen()}
              aria-controls="stats-definitions"
              onClick={toggleDefinitions}
            >
              <CircleQuestionMark size={15} aria-hidden="true" />
              <span>How this works</span>
            </button>
            <Show when={definitionsOpen()}>
              <div
                ref={definitionsPanel}
                class="stats-definitions"
                id="stats-definitions"
                role="dialog"
                aria-labelledby="stats-definitions-title"
                tabIndex={-1}
              >
                <div class="stats-definitions-header">
                  <h3 id="stats-definitions-title">How to read this</h3>
                  <button
                    class="stats-definitions-close"
                    type="button"
                    aria-label="Close stats explanation"
                    onClick={closeDefinitions}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>Articles</dt>
                    <dd>Distinct articles Sift encountered while refreshing this feed. You may not have opened all of them.</dd>
                  </div>
                  <div>
                    <dt>Read</dt>
                    <dd>Articles you opened at least once. Reading an article again does not add to this number.</dd>
                  </div>
                  <div>
                    <dt>Rate</dt>
                    <dd>The share of this feed's articles that you read.</dd>
                  </div>
                  <div>
                    <dt>Expected</dt>
                    <dd>How many articles you might have read at your overall reading rate.</dd>
                  </div>
                  <div>
                    <dt>Preference</dt>
                    <dd>How your reading compares with that expectation. 1.0x is your average; higher means you read this feed more than usual.</dd>
                  </div>
                  <div>
                    <dt>Not read yet</dt>
                    <dd>The articles in this history that you have not read at least once. It is a lifetime estimate, not your current unread list.</dd>
                  </div>
                </dl>
                <Show when={approximate()}>
                  <p class="stats-definitions-note">With sync, article totals are estimates across devices. An article still counts as read only once.</p>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        <Show when={!summary.loading} fallback={<div class="stats-message">Loading statistics...</div>}>
          <Show when={summary()} fallback={<div class="stats-message">Statistics are unavailable right now.</div>}>
            {(data) => (
              <>
                <section class="stats-summary" aria-label="Overall statistics">
                  <div class="stats-summary-item">
                    <span class="stats-summary-label">Articles</span>
                    <strong>{formatNumber(data().totalSeen)}</strong>
                    <span class="stats-summary-note">across your feeds</span>
                  </div>
                  <div class="stats-summary-item">
                    <span class="stats-summary-label">Read</span>
                    <strong>{formatNumber(data().readOnce)}</strong>
                    <span class="stats-summary-note">at least once</span>
                  </div>
                  <div class="stats-summary-item">
                    <span class="stats-summary-label">Reading rate</span>
                    <strong>{formatRate(data().readRate)}</strong>
                    <span class="stats-summary-note">across all feeds</span>
                  </div>
                </section>

                <section class="stats-list" aria-label="Feed statistics">
                  <div class="stats-list-heading">
                    <div class="stats-list-title">
                      <div class="stats-list-title-copy">
                        <h2>By feed</h2>
                        <span>{data().feeds.length} current subscriptions</span>
                      </div>
                    </div>
                    <label class="stats-sort">
                      <ArrowDownUp size={14} />
                      <span class="sr-only">Sort feeds</span>
                      <select value={sort()} onChange={(event) => setSort(event.currentTarget.value as StatsSort)}>
                        <option value="readOnce">Most read</option>
                        <option value="readRate">Highest rate</option>
                        <option value="backlog">Most not read yet</option>
                      </select>
                    </label>
                  </div>

                  <Show when={rows().length > 0} fallback={<div class="stats-message stats-message-inline">Subscribe to a feed to start building a reading history.</div>}>
                    <div class="stats-table" role="table" aria-label="Reading history by feed">
                      <div class="stats-table-head" role="row">
                        <span role="columnheader">Feed</span>
                        <span role="columnheader">Articles</span>
                        <span role="columnheader">Read</span>
                        <span role="columnheader">Rate</span>
                        <span role="columnheader">Expected</span>
                        <span role="columnheader">Preference</span>
                      </div>
                      <For each={rows()}>
                        {(row) => (
                          <article class="stats-row" role="row">
                            <div class="stats-feed" role="cell">
                              <strong title={row.title}>{row.title}</strong>
                              <span class="stats-feed-url" title={row.url}>{row.url}</span>
                              <span class="stats-volume-bar" aria-hidden="true">
                                <span style={{ width: `${Math.round((row.totalSeen / maxVolume()) * 100)}%` }} />
                              </span>
                            </div>
                            <div class="stats-value" role="cell" data-label="Articles">
                              <strong>{formatNumber(row.totalSeen)}</strong>
                            </div>
                            <div class="stats-value" role="cell" data-label="Read">
                              <strong>{formatNumber(row.readOnce)}</strong>
                            </div>
                            <div class="stats-value" role="cell" data-label="Rate">
                              <strong>{formatRate(row.readRate)}</strong>
                            </div>
                            <div class="stats-value" role="cell" data-label="Expected">
                              <strong>{formatExpected(row.expectedReads)}</strong>
                            </div>
                            <div class="stats-value stats-index" role="cell" data-label="Preference">
                              <strong>{formatIndex(row.readIndex)}</strong>
                            </div>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </>
            )}
          </Show>
        </Show>
      </div>
    </main>
  );
}
