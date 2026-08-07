import { createSignal, onCleanup, createResource, Show, For } from 'solid-js';
import { Check, Copy, Trash2 } from 'lucide-solid';
import { useApp } from '../state';
import { mintAgentCode, listAgentTokens, revokeAgentToken, type AgentTokenInfo } from '../sync/client';
import { expiryLabel } from '../util/time';

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
  const [copiedInstall, setCopiedInstall] = createSignal(false);
  const [copiedCmd, setCopiedCmd] = createSignal(false);
  const [showTerminal, setShowTerminal] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [ringFraction, setRingFraction] = createSignal(1);
  let ringTimer: ReturnType<typeof setInterval> | undefined;

  const [tokens] = createResource(() => listAgentTokens());

  const expired = () => expiresAt() !== null && Date.now() >= expiresAt()!;

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
      setShowTerminal(false);
      startRingTimer(res.expiresAt);
    } catch (e) {
      setCode(null);
      setExpiresAt(null);
      console.error('Failed to create a code:', e);
      setError('Failed to create a code. Try again.');
    }
  };

  const copyPrompt = async () => {
    const c = code();
    if (!c) return;
    const origin = window.location.origin;
    await navigator.clipboard.writeText(
      `You are my Sift RSS agent.

What you can do
- Read my subscriptions and items. Fetch GET ${origin}/sync/pull?code=${c}
- Propose feeds to add. Send a link: ${origin}/?intent=add&url=<feed-url>

Rules
- Access expires in 5 minutes.
- You cannot change my subscriptions. I approve each add by clicking its link.

Reference: ${origin}/openapi.json`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyInstall = async () => {
    await navigator.clipboard.writeText('npm i -g siftctl');
    setCopiedInstall(true);
    setTimeout(() => setCopiedInstall(false), 2000);
  };

  const copyCommand = async () => {
    const c = code();
    if (!c) return;
    await navigator.clipboard.writeText(`siftctl pair ${c}`);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  const revoke = (token: AgentTokenInfo) => {
    ctx.openModal({
      kind: 'confirm',
      title: 'Revoke agent',
      message: `Revoke access for ${token.fingerprint}?`,
      hint: 'The agent will lose access immediately. It can be paired again later.',
      confirmLabel: 'Revoke',
      danger: true,
      returnTo: { kind: 'agents' },
      onConfirm: async () => {
        setError(null);
        try {
          await revokeAgentToken(token.token_id);
        } catch (e) {
          console.error('Failed to revoke agent:', e);
          setError('Failed to revoke. Try again.');
        }
      },
    });
  };

  onCleanup(() => {
    clearInterval(ringTimer);
  });

  return (
    <div class="modal modal-center">
      <div class="modal-header">Agents</div>
      <div class="modal-body">
        <Show when={!code()}>
          <div style="margin-bottom: 10px; font-size: 14px; color: var(--subtext)">
            Give a chat tool or coding agent access to read your feeds and propose additions.
          </div>
        </Show>
        <Show when={!code() && !error()}>
          <button class="btn" onClick={() => void generateCode()}>Pair an agent</button>
        </Show>
        <Show when={code()}>
          <Show when={!expired()}>
            <div style="margin-bottom: 10px; font-size: 14px; color: var(--subtext)">
              Copy the prompt and paste it into a chat tool or coding agent.
            </div>
            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px">
              <button class="btn primary" onClick={() => void copyPrompt()} aria-label="Copy starter prompt for a chat tool">
                {copied() ? <Check size={14} /> : <Copy size={14} />}
                <span style="margin-left: 4px">Copy prompt</span>
              </button>
              <div style="display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--subtext)">
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
                {`Expires in ${expiryLabel(expiresAt()!)}`}
              </div>
            </div>
            <button
              class="sync-grid__copy"
              style="margin-bottom: 10px"
              onClick={() => setShowTerminal((v) => !v)}
              aria-expanded={showTerminal()}
            >
              Using a terminal?
            </button>
            <Show when={showTerminal()}>
              <div style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; font-size: 13px; color: var(--subtext)">
                <div>Install <code style="font-size: 13px">siftctl</code> and pair it to manage your subscriptions from the terminal.</div>
                <div class="codeblock">
                  <code>npm i -g siftctl</code>
                  <button class="codeblock__copy" onClick={() => void copyInstall()} aria-label="Copy install command">
                    {copiedInstall() ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
                <div class="codeblock">
                  <code>siftctl pair {code() ?? '&lt;code&gt;'}</code>
                  <button class="codeblock__copy" onClick={() => void copyCommand()} aria-label="Copy siftctl pair command">
                    {copiedCmd() ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            </Show>
          </Show>
          <Show when={expired()}>
            <p style="margin: 0 0 8px; font-size: 14px; color: var(--subtext)">The code expired.</p>
            <button class="btn" onClick={() => void generateCode()}>Get a new code</button>
          </Show>
        </Show>
        <Show when={error()}>
          <p class="error">{error()}</p>
        </Show>
        <div style="font-size: 14px">
          <Show
            when={!tokens.loading && tokens() && tokens()!.length > 0}
            fallback={
              <div style="color: var(--subtext); margin-top: 12px">No agents paired yet.</div>
            }
          >
            <div style="display: flex; flex-direction: column; gap: 8px">
              <For each={tokens()}>
                {(token) => (
                  <div class="row" style="align-items: center">
                    <label style="flex: 1; min-width: 0">
                      <span style="font-weight: 600">{token.fingerprint}</span>
                      <span style="display: block; font-size: 13px; color: var(--subtext)">
                        {token.scope} · created {relativeTime(token.created_at)} · last seen {token.last_seen_at === null ? 'not seen yet' : relativeTime(token.last_seen_at)}
                      </span>
                    </label>
                    <button
                      class="btn"
                      onClick={() => revoke(token)}
                    >
                      <Trash2 size={14} />
                      Revoke
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn primary" onClick={() => ctx.closeModal()}>Close</button>
      </div>
    </div>
  );
}
