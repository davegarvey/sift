import { ArrowDownUp, ChartNoAxesCombined } from 'lucide-solid';
import { createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { useApp } from '../state';
import { loadStats, sortFeedStats, type StatsSort } from '../stats/service';

const numberFormat = new Intl.NumberFormat();

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function formatRate(value: number | null): string {
  return value == null ? 'Unavailable' : `${Math.round(value * 100)}%`;
}

function formatExpected(value: number | null): string {
  return value == null ? 'Unavailable' : value.toFixed(1);
}

function formatIndex(value: number | null): string {
  return value == null ? 'Unavailable' : `${value.toFixed(1)}x`;
}

export function Stats() {
  const ctx = useApp();
  const [sort, setSort] = createSignal<StatsSort>('readOnce');
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
        <header class="stats-header">
          <div class="stats-kicker"><ChartNoAxesCombined size={16} /> Reading ledger</div>
          <h1>Stats</h1>
          <p>
            A durable view of what your feeds publish and what you read once.
            <Show when={approximate()}>
              {' '}Synced observed volume is approximate; read-once counts are exact for accepted reads.
            </Show>
            <Show when={!approximate()}>
              {' '}It stays on this device and works offline.
            </Show>
          </p>
        </header>

        <Show when={!summary.loading} fallback={<div class="stats-message">Loading statistics...</div>}>
          <Show when={summary()} fallback={<div class="stats-message">Statistics are unavailable right now.</div>}>
            {(data) => (
              <>
                <section class="stats-summary" aria-label="Overall statistics">
                  <div class="stats-summary-item">
                    <span class="stats-summary-label">Observed volume</span>
                    <strong>{formatNumber(data().totalSeen)}</strong>
                    <span class="stats-summary-note">articles seen</span>
                  </div>
                  <div class="stats-summary-item">
                    <span class="stats-summary-label">Read once</span>
                    <strong>{formatNumber(data().readOnce)}</strong>
                    <span class="stats-summary-note">lifetime reads</span>
                  </div>
                  <div class="stats-summary-item">
                    <span class="stats-summary-label">Read rate</span>
                    <strong>{formatRate(data().readRate)}</strong>
                    <span class="stats-summary-note">read once / observed</span>
                  </div>
                </section>

                <section class="stats-list" aria-label="Feed statistics">
                  <div class="stats-list-heading">
                    <div>
                      <h2>By feed</h2>
                      <span>{data().feeds.length} current subscriptions</span>
                    </div>
                    <label class="stats-sort">
                      <ArrowDownUp size={14} />
                      <span class="sr-only">Sort feeds</span>
                      <select value={sort()} onChange={(event) => setSort(event.currentTarget.value as StatsSort)}>
                        <option value="readOnce">Most read</option>
                        <option value="readRate">Read rate</option>
                        <option value="backlog">Lifetime backlog</option>
                      </select>
                    </label>
                  </div>

                  <Show when={rows().length > 0} fallback={<div class="stats-message stats-message-inline">Subscribe to a feed to start building a reading history.</div>}>
                    <div class="stats-table" role="table" aria-label="Reading statistics by feed">
                      <div class="stats-table-head" role="row">
                        <span role="columnheader">Feed</span>
                        <span role="columnheader">Volume</span>
                        <span role="columnheader">Read once</span>
                        <span role="columnheader">Rate</span>
                        <span role="columnheader">xR</span>
                        <span role="columnheader">Index</span>
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
                            <div class="stats-value" role="cell" data-label="Volume">
                              <strong>{formatNumber(row.totalSeen)}</strong>
                              <span>observed</span>
                            </div>
                            <div class="stats-value" role="cell" data-label="Read once">
                              <strong>{formatNumber(row.readOnce)}</strong>
                              <span>{formatNumber(row.backlog)} backlog</span>
                            </div>
                            <div class="stats-value" role="cell" data-label="Rate">
                              <strong>{formatRate(row.readRate)}</strong>
                              <span>{row.readRate == null ? 'no baseline' : `${formatNumber(row.readOnce)} / ${formatNumber(row.totalSeen)}`}</span>
                            </div>
                            <div class="stats-value" role="cell" data-label="xR">
                              <strong>{formatExpected(row.expectedReads)}</strong>
                              <span>expected</span>
                            </div>
                            <div class="stats-value stats-index" role="cell" data-label="Index">
                              <strong>{formatIndex(row.readIndex)}</strong>
                              <span>relative</span>
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
