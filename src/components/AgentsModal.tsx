import { createSignal, onMount, onCleanup, createResource, Show, For } from 'solid-js';
import { Check, Copy, Trash2 } from 'lucide-solid';
import { useApp } from '../state';
import { mintAgentCode, listAgentTokens, revokeAgentToken, type AgentTokenInfo } from '../sync/client';

function relativeTime(t: number | null): string {
  if (t === null) return 'never';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function AgentsModal() {
  const ctx = useApp();
  const [code, setCode] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmId, setConfirmId] = createSignal<string | null>(null);
  const [ringFraction, setRingFraction] = createSignal(1);
  const [reloadTick, setReloadTick] = createSignal(0);
  let ringTimer: ReturnType<typeof setInterval> | undefined;

  const [tokens] = createResource(
    () => reloadTick(),
    () => listAgentTokens(),
  );

  const startRingTimer = (exp: number) => {
    clearInterval(ringTimer);
    setRingFraction(1);
    ringTimer = setInterval(() => {
      const remaining = exp - Date.now();
      setRingFraction(Math.max(0, remaining / (5 * 60 * 1000)));
    }, 1000);
  };

  const generateCode = async () => {
    setError(null);
    try {
      const res = await mintAgentCode();
      setCode(res.code);
      setExpiresAt(res.expiresAt);
      startRingTimer(res.expiresAt);
    } catch (e) {
      setCode(null);
      setExpiresAt(null);
      setError(e instanceof Error ? e.message : 'Failed to mint a code');
    }
  };

  const copyCode = async () => {
    if (!code()) return;
    await navigator.clipboard.writeText(code()!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const revoke = async (token: AgentTokenInfo) => {
    if (confirmId() !== token.token_id) {
      setConfirmId(token.token_id);
      return;
    }
    setConfirmId(null);
    setError(null);
    try {
      await revokeAgentToken(token.token_id);
      setReloadTick((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke');
    }
  };

  onMount(() => {
    void generateCode();
  });

  onCleanup(() => {
    clearInterval(ringTimer);
  });

  return (
    <div class="modal modal-center">
      <div class="modal-header">Agents</div>
      <div class="modal-body">
        <div style="margin-bottom: 10px; font-size: 13px; color: var(--subtext)">
          Give an AI agent (or a tool like ChatGPT) access to this sync group.
          Pair it, then run <code style="font-size: 12px">siftctl pair {code() ?? '&lt;code&gt;'}</code> —
          or paste the code into the tool. Revoke anytime; your devices are unaffected.
        </div>
        <Show when={code()}>
          <div class="sync-grid" style="margin-bottom: 14px">
            <div class="sync-grid__cell">
              <span class="sync-grid__label">Pairing code</span>
              <span class="sync-grid__code">{code()}</span>
              <div style="display: flex; gap: 6px; justify-content: center">
                <button class="sync-grid__copy" onClick={() => void copyCode()} aria-label="Copy agent pairing code">
                  {copied() ? <Check size={14} /> : <Copy size={14} />}
                  <span style="font-size: 12px">Copy</span>
                </button>
              </div>
            </div>
          </div>
        </Show>
        <Show when={!code() && !error()}>
          <button class="btn" onClick={() => void generateCode()}>Pair an agent</button>
        </Show>
        <Show when={error()}>
          <p class="error" style="margin: 4px 0; font-size: 13px">{error()}</p>
        </Show>
        <Show when={expiresAt()}>
          <div style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--subtext); margin-bottom: 10px">
            <svg class="code-timer" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="code-timer__bg" cx="12" cy="12" r="10" />
              <circle
                class="code-timer__progress"
                cx="12" cy="12" r="10"
                stroke-dasharray={`${2 * Math.PI * 10}`}
                stroke-dashoffset={`${2 * Math.PI * 10 * (1 - ringFraction())}`}
                style={{ stroke: ringFraction() > 0.1 ? undefined : 'var(--red)' }}
              />
            </svg>
            {`Expires in ${Math.max(0, Math.ceil((expiresAt()! - Date.now()) / 60000))} min`}
          </div>
        </Show>
        <div style="font-size: 13px">
          <Show
            when={!tokens.loading && tokens() && tokens()!.length > 0}
            fallback={
              <div style="color: var(--subtext)">No agents paired yet.</div>
            }
          >
            <div style="display: flex; flex-direction: column; gap: 8px">
              <For each={tokens()}>
                {(token) => (
                  <div class="row" style="align-items: center">
                    <label style="flex: 1; min-width: 0">
                      <span style="font-weight: 600">{token.fingerprint}</span>
                      <span style="display: block; font-size: 12px; color: var(--subtext)">
                        {token.scope} · created {relativeTime(token.created_at)} · last seen {relativeTime(token.last_seen_at)}
                      </span>
                    </label>
                    <button
                      class="btn"
                      classList={{ 'btn-danger': confirmId() === token.token_id }}
                      onClick={() => void revoke(token)}
                    >
                      <Trash2 size={14} />
                      {confirmId() === token.token_id ? 'Confirm' : 'Revoke'}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class="modal-footer" style="justify-content: space-between">
        <span style="font-size: 12px; color: var(--subtext)">Tokens are revocable; agents can read and change subscriptions.</span>
        <button class="btn primary" onClick={() => ctx.closeModal()}>Close</button>
      </div>
    </div>
  );
}
