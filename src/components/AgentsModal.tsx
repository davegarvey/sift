import { createSignal, onCleanup, createResource, Show, For } from 'solid-js';
import { Check, ChevronRight, Copy, Pencil, Plug, ScanLine, Trash2, X } from 'lucide-solid';
import { useApp } from '../state';
import {
  mintAgentConnection,
  listAgentTokens,
  renameAgentToken,
  revokeAgentToken,
  SyncClientError,
  type AgentTokenInfo,
} from '../sync/client';
import { decideApproval, lookupApproval } from '../agents/api';
import {
  AgentApiError,
  accessLabel,
  displayApprovalCode,
  normaliseApprovalCode,
  type AccessView,
} from '../agents/approval';
import { ClientSummary } from '../agents/ClientSummary';
import { QrScannerOverlay } from './QrScannerOverlay';
import { expiryLabel, humanRelativeTime } from '../util/time';

const CONNECTION_TTL_MS = 10 * 60 * 1000;
const LABEL_MAX = 64;

function approvalErrorMessage(e: unknown): string {
  if (e instanceof AgentApiError) {
    if (e.status === 404) return 'No request matches that code. Check it and try again.';
    if (e.status === 410) return 'That request has expired. Restart the connection from your agent.';
    if (e.status === 409) return 'That request has already been decided.';
    if (e.status === 429) return 'Too many attempts. Wait a minute and try again.';
    if (e.status === 401) return 'Sift could not confirm your account. Check that sync is on.';
  }
  return 'Could not reach Sift. Try again.';
}

function titleOf(token: AgentTokenInfo): string {
  return token.label || token.client_name || 'Paired token';
}

export function AgentsModal() {
  const ctx = useApp();
  const [connectUrl, setConnectUrl] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [connectBusy, setConnectBusy] = createSignal(false);
  const [copiedUrl, setCopiedUrl] = createSignal(false);
  const [copiedMcp, setCopiedMcp] = createSignal(false);
  const [autoCopied, setAutoCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [codeInput, setCodeInput] = createSignal('');
  const [lookup, setLookup] = createSignal<{ code: string; view: AccessView } | null>(null);
  const [approvalBusy, setApprovalBusy] = createSignal(false);
  const [approvalMessage, setApprovalMessage] = createSignal<string | null>(null);
  const [approvalError, setApprovalError] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal(false);

  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal('');

  const [tokens, { refetch }] = createResource(() => listAgentTokens().catch((e: unknown) => {
    console.error('Failed to list agents:', e);
    return [] as AgentTokenInfo[];
  }));

  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const expired = () => expiresAt() !== null && now() >= expiresAt()!;
  const fraction = () => (expiresAt() === null ? 0 : Math.max(0, Math.min(1, (expiresAt()! - now()) / CONNECTION_TTL_MS)));
  const mcpUrl = () => `${connectUrl() ? new URL(connectUrl()!).origin : window.location.origin}/mcp`;

  const connect = async () => {
    if (connectBusy()) return;
    setConnectBusy(true);
    setError(null);
    setAutoCopied(false);
    try {
      const res = await mintAgentConnection();
      setConnectUrl(res.url);
      setExpiresAt(res.expiresAt);
      setNow(Date.now());
      try {
        await navigator.clipboard.writeText(res.url);
        setAutoCopied(true);
      } catch {
        setAutoCopied(false);
      }
    } catch (e) {
      console.error('Failed to create a connection link:', e);
      setError(
        e instanceof SyncClientError && e.status === 429
          ? 'Too many links created recently. Try again shortly.'
          : 'Could not create a connection link. Try again.',
      );
    } finally {
      setConnectBusy(false);
    }
  };

  const copy = async (text: string, flag: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      flag(true);
      setTimeout(() => flag(false), 2000);
    } catch {
      setError('Could not copy. Select the text and copy it by hand.');
    }
  };

  const findRequest = async (raw: string) => {
    setApprovalMessage(null);
    setApprovalError(null);
    setLookup(null);
    const code = normaliseApprovalCode(raw);
    if (!code) {
      setApprovalError('Enter the 8-character code shown on the connection page.');
      return false;
    }
    setApprovalBusy(true);
    try {
      const view = await lookupApproval(code);
      if (view.status === 'expired') setApprovalError('That request has expired. Restart the connection from your agent.');
      else if (view.status !== 'pending') setApprovalError('That request has already been decided.');
      else setLookup({ code, view });
      return true;
    } catch (e) {
      setApprovalError(approvalErrorMessage(e));
      return true;
    } finally {
      setApprovalBusy(false);
    }
  };

  const decide = async (decision: 'approve' | 'deny') => {
    const current = lookup();
    if (!current || approvalBusy()) return;
    setApprovalBusy(true);
    setApprovalError(null);
    try {
      await decideApproval(current.code, decision);
      setApprovalMessage(decision === 'approve' ? `${current.view.clientName} is now connected.` : `Denied ${current.view.clientName}.`);
      setLookup(null);
      setCodeInput('');
      if (decision === 'approve') void refetch();
    } catch (e) {
      setApprovalError(approvalErrorMessage(e));
      if (e instanceof AgentApiError && (e.status === 409 || e.status === 410)) setLookup(null);
    } finally {
      setApprovalBusy(false);
    }
  };

  const onScanned = (text: string): boolean => {
    const code = normaliseApprovalCode(text);
    if (!code) return false;
    setScanning(false);
    setCodeInput(displayApprovalCode(code));
    void findRequest(code);
    return true;
  };

  const startRename = (token: AgentTokenInfo) => {
    setRenaming(token.token_id);
    setRenameValue(token.label ?? '');
  };

  const saveRename = async (token: AgentTokenInfo) => {
    setError(null);
    try {
      await renameAgentToken(token.token_id, renameValue().trim());
      setRenaming(null);
      void refetch();
    } catch (e) {
      console.error('Failed to rename agent:', e);
      setError('Could not rename. Try again.');
    }
  };

  const revoke = (token: AgentTokenInfo) => {
    ctx.openModal({
      kind: 'confirm',
      title: 'Revoke agent',
      message: `Revoke access for ${titleOf(token)}?`,
      hint: 'The agent loses access immediately. It can be connected again later.',
      confirmLabel: 'Revoke',
      danger: true,
      returnTo: { kind: 'agents' },
      onConfirm: async () => {
        try {
          await revokeAgentToken(token.token_id);
        } catch (e) {
          console.error('Failed to revoke agent:', e);
        }
      },
    });
  };

  return (
    <div class="modal modal-center">
      <div class="modal-header">Agents</div>
      <div class="modal-body">
        <Show when={!scanning()} fallback={<QrScannerOverlay onClose={() => setScanning(false)} onText={onScanned} />}>
          <section class="agents-section">
            <h3>Connect an agent</h3>
            <button class="btn primary agents-button" disabled={connectBusy()} onClick={() => void connect()}>
              <Plug size={14} />
              {connectUrl() && expired() ? 'Create a new link' : 'Connect an agent'}
            </button>
            <Show when={connectUrl() && !expired()}>
              <div class="codeblock">
                <code class="agents-url">{connectUrl()}</code>
                <button class="codeblock__copy" onClick={() => void copy(connectUrl()!, setCopiedUrl)} aria-label="Copy connection link">
                  {copiedUrl() ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <div class="agents-timer">
                <svg class="code-timer" viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="code-timer__bg" cx="12" cy="12" r="10" />
                  <circle
                    class="code-timer__progress"
                    cx="12" cy="12" r="10"
                    stroke-dasharray={`${2 * Math.PI * 10}`}
                    stroke-dashoffset={`${2 * Math.PI * 10 * (1 - fraction())}`}
                    style={{ stroke: fraction() > 0.1 ? undefined : 'var(--red)' }}
                  />
                </svg>
                {`${autoCopied() ? 'Copied. ' : ''}Expires in ${expiryLabel(expiresAt()!)}`}
              </div>
              <p class="agents-note">Paste this into your agent as a custom connector or remote MCP server, then tap Allow.</p>
            </Show>
            <Show when={connectUrl() && expired()}>
              <p class="agents-note">That link has expired. Create a new one.</p>
            </Show>
            <div class="agents-note agents-small">
              For clients you configure by hand, the plain server address is:
              <div class="codeblock" style="margin-top: 4px">
                <code class="agents-url">{mcpUrl()}</code>
                <button class="codeblock__copy" onClick={() => void copy(mcpUrl(), setCopiedMcp)} aria-label="Copy MCP address">
                  {copiedMcp() ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
            <Show when={error()}>
              <p class="error" role="alert">{error()}</p>
            </Show>
          </section>

          <section class="agents-section">
            <details class="agents-details">
              <summary><ChevronRight size={14} />Using HTTP?</summary>
              <div class="agents-note">
                Agents that call Sift over HTTP can read the <a href="/openapi.json" target="_blank" rel="noopener">OpenAPI description</a> and the <a href="/llms.txt" target="_blank" rel="noopener">llms.txt guide</a>.
              </div>
            </details>
          </section>

          <section class="agents-section">
            <h3>Approve a connection</h3>
            <p class="agents-note">If an agent shows an approval code, enter it here, or scan its QR code.</p>
            <form
              class="agents-form"
              onSubmit={(e) => { e.preventDefault(); void findRequest(codeInput()); }}
            >
              <input
                class="agents-input agents-input--code"
                type="text"
                value={codeInput()}
                onInput={(e) => setCodeInput(e.currentTarget.value)}
                placeholder="abcd-efgh"
                aria-label="Approval code"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck={false}
                disabled={approvalBusy()}
              />
              <button class="btn" type="submit" disabled={approvalBusy() || !codeInput().trim()}>Look up</button>
              <button class="btn" type="button" onClick={() => setScanning(true)} aria-label="Scan a QR code">
                <ScanLine size={14} />
              </button>
            </form>
            <Show when={approvalError()}>
              <p class="error" role="alert">{approvalError()}</p>
            </Show>
            <Show when={approvalMessage()}>
              <p class="success" role="status">{approvalMessage()}</p>
            </Show>
            <Show when={lookup()}>
              {(found) => (
                <>
                  <p class="agents-note">Connect this agent to your Sift?</p>
                  <ClientSummary view={found().view} />
                  <div class="agents-button-row">
                    <button class="btn primary" disabled={approvalBusy()} onClick={() => void decide('approve')}>Approve</button>
                    <button class="btn subtle" disabled={approvalBusy()} onClick={() => void decide('deny')}>Deny</button>
                  </div>
                </>
              )}
            </Show>
          </section>

          <Show when={!tokens.loading && (tokens()?.length ?? 0) > 0}>
            <section class="agents-section">
              <h3>Connected agents</h3>
              <div class="agents-list">
                <For each={tokens()}>
                  {(token) => (
                    <div class="agents-row">
                      <div class="agents-row__main">
                        <Show
                          when={renaming() === token.token_id}
                          fallback={
                            <div class="agents-row__title">
                              <span>{titleOf(token)}</span>
                              <Show when={token.unverified}><span class="unverified-mark">unverified</span></Show>
                            </div>
                          }
                        >
                          <form
                            class="agents-form"
                            onSubmit={(e) => { e.preventDefault(); void saveRename(token); }}
                          >
                            <input
                              class="agents-input"
                              type="text"
                              maxLength={LABEL_MAX}
                              value={renameValue()}
                              placeholder={token.client_name ?? 'Paired token'}
                              aria-label="Agent name"
                              onInput={(e) => setRenameValue(e.currentTarget.value)}
                              onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }}
                              ref={(el) => queueMicrotask(() => el.focus())}
                            />
                            <button class="btn" type="submit" aria-label="Save name"><Check size={14} /></button>
                            <button class="btn subtle" type="button" aria-label="Cancel rename" onClick={() => setRenaming(null)}><X size={14} /></button>
                          </form>
                        </Show>
                        <Show when={token.label && token.client_name}>
                          <div class="agents-row__detail">{token.client_name}</div>
                        </Show>
                        <Show when={token.client_host}>
                          <div class="agents-row__detail">{token.client_host}</div>
                        </Show>
                        <div class="agents-row__detail">
                          {accessLabel(token.scopes)} · connected {humanRelativeTime(new Date(token.created_at))} · last used {token.last_seen_at === null ? 'never' : humanRelativeTime(new Date(token.last_seen_at))}
                        </div>
                        <div class="agents-row__secondary">ID {token.fingerprint}</div>
                      </div>
                      <div class="agents-row__actions">
                        <button class="btn subtle" aria-label={`Rename ${titleOf(token)}`} onClick={() => startRename(token)}>
                          <Pencil size={14} />
                        </button>
                        <button class="btn subtle" aria-label={`Revoke ${titleOf(token)}`} onClick={() => revoke(token)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </Show>
        </Show>
      </div>
      <div class="modal-footer">
        <button class="btn primary" onClick={() => ctx.closeModal()}>Close</button>
      </div>
    </div>
  );
}
