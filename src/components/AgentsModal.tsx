import { createSignal, onCleanup, createResource, Show, For } from 'solid-js';
import { Check, Copy, Pencil, ScanLine, Trash2, X } from 'lucide-solid';
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

function detailOf(token: AgentTokenInfo): string {
  const parts: string[] = [];
  if (token.label && token.client_name) parts.push(token.client_name);
  if (token.unverified && token.client_host) parts.push(token.client_host);
  if (accessLabel(token.scopes) === 'Read only') parts.push('Read only');
  parts.push(token.last_seen_at === null ? 'Not used yet' : `Last used ${humanRelativeTime(new Date(token.last_seen_at))}`);
  return parts.join(' · ');
}

export function AgentsModal() {
  const ctx = useApp();
  const [connectUrl, setConnectUrl] = createSignal<string | null>(null);
  const [expiresAt, setExpiresAt] = createSignal<number | null>(null);
  const [now, setNow] = createSignal(Date.now());
  const [connectBusy, setConnectBusy] = createSignal(false);
  const [copiedUrl, setCopiedUrl] = createSignal(false);
  const [autoCopied, setAutoCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [codeInput, setCodeInput] = createSignal('');
  const [lookup, setLookup] = createSignal<{ code: string; view: AccessView } | null>(null);
  const [approvalBusy, setApprovalBusy] = createSignal(false);
  const [approvalMessage, setApprovalMessage] = createSignal<string | null>(null);
  const [approvalError, setApprovalError] = createSignal<string | null>(null);
  const [scanning, setScanning] = createSignal(false);
  const [showApprove, setShowApprove] = createSignal(false);

  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal('');

  const [tokens, { refetch }] = createResource(() => listAgentTokens().catch((e: unknown) => {
    console.error('Failed to list agents:', e);
    return [] as AgentTokenInfo[];
  }));

  const timer = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(timer));

  const expired = () => expiresAt() !== null && now() >= expiresAt()!;

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
      <div class="modal-header">Agent access</div>
      <div class="modal-body">
        <Show when={!scanning()} fallback={<QrScannerOverlay onClose={() => setScanning(false)} onText={onScanned} />}>
          <section class="agents-section">
            <p class="agents-note">Let an AI agent read and manage your feeds.</p>
            <Show
              when={connectUrl() && !expired()}
              fallback={
                <button class="btn primary agents-button" disabled={connectBusy()} onClick={() => void connect()}>
                  {connectUrl() ? 'Create a new link' : 'Connect an agent'}
                </button>
              }
            >
              <div class="codeblock">
                <code class="agents-url">{connectUrl()}</code>
                <button class="codeblock__copy" onClick={() => void copy(connectUrl()!, setCopiedUrl)} aria-label="Copy connection link">
                  {copiedUrl() ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <p class="agents-note">
                {`${autoCopied() ? 'Copied. ' : ''}Paste it into your agent, then tap Allow. Expires in ${expiryLabel(expiresAt()!)}.`}
              </p>
            </Show>
            <Show when={error()}>
              <p class="error" role="alert">{error()}</p>
            </Show>
          </section>

          <Show when={!tokens.loading && (tokens()?.length ?? 0) > 0}>
            <section class="agents-section">
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
                        <div class="agents-row__detail">{detailOf(token)}</div>
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

          <section class="agents-section">
            <Show
              when={showApprove()}
              fallback={
                <button class="agents-link" onClick={() => setShowApprove(true)}>Have an approval code?</button>
              }
            >
              <form
                class="agents-form"
                onSubmit={(e) => { e.preventDefault(); void findRequest(codeInput()); }}
              >
                <input
                  class="agents-input agents-input--code"
                  type="text"
                  value={codeInput()}
                  onInput={(e) => setCodeInput(e.currentTarget.value)}
                  placeholder="Approval code"
                  aria-label="Approval code"
                  autocomplete="off"
                  autocorrect="off"
                  autocapitalize="off"
                  spellcheck={false}
                  disabled={approvalBusy()}
                  ref={(el) => queueMicrotask(() => el.focus())}
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
                    <ClientSummary view={found().view} />
                    <div class="agents-button-row">
                      <button class="btn primary" disabled={approvalBusy()} onClick={() => void decide('approve')}>Approve</button>
                      <button class="btn subtle" disabled={approvalBusy()} onClick={() => void decide('deny')}>Deny</button>
                    </div>
                  </>
                )}
              </Show>
            </Show>
          </section>
        </Show>
      </div>
      <div class="modal-footer">
        <button class="btn" onClick={() => ctx.closeModal()}>Done</button>
      </div>
    </div>
  );
}
