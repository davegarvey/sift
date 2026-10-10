import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Check, Copy } from 'lucide-solid';
import { AgentApiError, displayApprovalCode, isSafeRedirect } from '../agents/approval';
import { ClientSummary } from '../agents/ClientSummary';
import { peekStoredSyncKey } from '../sync/peek';
import { renderSyncKeyQr } from '../sync/qr';
import { decideRequest, fetchRequest, type RequestView } from './api';
import '../styles.css';

const POLL_MS = 2000;

type Load = 'loading' | 'ready' | 'invalid' | 'notfound' | 'unreachable';

function clockTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ConnectPage(props: { requestId?: string | null; navigate?: (url: string) => void; pollMs?: number }) {
  const requestId = props.requestId !== undefined ? props.requestId : new URLSearchParams(window.location.search).get('request');
  const navigate = props.navigate ?? ((url: string) => window.location.assign(url));
  const [load, setLoad] = createSignal<Load>(requestId ? 'loading' : 'invalid');
  const [view, setView] = createSignal<RequestView | null>(null);
  const [syncKey, setSyncKey] = createSignal<string | null>(null);
  const [keyRejected, setKeyRejected] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const [problem, setProblem] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [blocked, setBlocked] = createSignal<string | null>(null);
  let mounted = true;

  const mode = createMemo(() => {
    const v = view();
    if (!v) return null;
    if (v.status !== 'pending') return v.status;
    if (v.connection.usable) return 'connection' as const;
    if (syncKey() && !keyRejected()) return 'key' as const;
    return 'code' as const;
  });

  const go = (redirect: string) => {
    if (!isSafeRedirect(redirect)) {
      setBlocked('Sift received an unexpected address to return to, so it has stopped. Start again from your agent.');
      return;
    }
    setLeaving(true);
    navigate(redirect);
  };

  const apply = (next: RequestView) => {
    setView(next);
    if (next.redirect) go(next.redirect);
  };

  const refresh = async () => {
    if (!requestId) return;
    try {
      apply(await fetchRequest(requestId));
    } catch (e) {
      if (e instanceof AgentApiError && e.status === 404) setLoad('notfound');
    }
  };

  onMount(() => {
    if (!requestId) return;
    void Promise.all([fetchRequest(requestId), peekStoredSyncKey()])
      .then(([next, key]) => {
        if (!mounted) return;
        setSyncKey(key);
        setLoad('ready');
        apply(next);
      })
      .catch((e: unknown) => {
        if (!mounted) return;
        setLoad(e instanceof AgentApiError && e.status === 404 ? 'notfound' : 'unreachable');
      });
  });

  createEffect(() => {
    if (mode() !== 'code' || leaving()) return;
    const timer = setInterval(() => void refresh(), props.pollMs ?? POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  onCleanup(() => {
    mounted = false;
  });

  const decide = async (decision: 'approve' | 'deny') => {
    if (!requestId || busy()) return;
    const usingKey = mode() === 'key';
    setBusy(true);
    setProblem(null);
    try {
      go(await decideRequest(requestId, decision, usingKey ? (syncKey() ?? undefined) : undefined));
    } catch (e) {
      if (!(e instanceof AgentApiError)) {
        setProblem('Could not reach Sift. Check your connection and try again.');
      } else if (e.status === 410) {
        const current = view();
        if (current) setView({ ...current, status: 'expired' });
      } else if (e.status === 409 || e.status === 404) {
        await refresh();
      } else if (e.status === 401 && usingKey) {
        setKeyRejected(true);
        setProblem('Sift on this browser could not confirm your account. Approve with the code below instead.');
      } else if (e.status === 401) {
        setProblem('This link can no longer be used.');
        await refresh();
      } else {
        setProblem('Something went wrong. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    const code = view()?.approvalCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem('Could not copy the code. Select and copy it by hand.');
    }
  };

  const retry = () => window.location.reload();

  return (
    <main class="connect">
      <div class="connect__brand">Sift</div>
      <div class="connect__card">
        <Switch>
          <Match when={load() === 'loading'}>
            <p class="connect__muted">Loading…</p>
          </Match>
          <Match when={load() === 'invalid'}>
            <h1>Link not valid</h1>
            <p>This page needs a connection request. Start again from your agent.</p>
          </Match>
          <Match when={load() === 'notfound'}>
            <h1>Request not found</h1>
            <p>Sift does not recognise this request. Start again from your agent.</p>
          </Match>
          <Match when={load() === 'unreachable'}>
            <h1>Cannot reach Sift</h1>
            <p>Check your connection and try again.</p>
            <div class="connect__actions">
              <button class="btn primary" onClick={retry}>Try again</button>
            </div>
          </Match>
          <Match when={blocked()}>
            <h1>Cannot continue</h1>
            <p>{blocked()}</p>
          </Match>
          <Match when={leaving()}>
            <h1>Returning to {view()?.clientName ?? 'your agent'}</h1>
            <p>If nothing happens, switch back to your agent. You can close this page.</p>
          </Match>
          <Match when={mode() === 'expired'}>
            <h1>Request expired</h1>
            <p>This request is no longer valid. Restart the connection from your agent.</p>
          </Match>
          <Match when={mode() === 'denied'}>
            <h1>Connection denied</h1>
            <p>Nothing was shared with {view()?.clientName}. You can close this page.</p>
          </Match>
          <Match when={mode() === 'approved'}>
            <h1>Already decided</h1>
            <p>This request has already been answered. Return to your agent, or restart the connection from it.</p>
          </Match>
          <Match when={mode() === 'connection' || mode() === 'key'}>
            <h1>Connect {view()?.clientName} to your Sift?</h1>
            <ClientSummary view={view()!} />
            <Show when={mode() === 'connection' && view()?.connection.createdAt}>
              <p class="connect__muted">Link created at {clockTime(view()!.connection.createdAt!)}</p>
            </Show>
            <Show when={mode() === 'key'}>
              <p class="connect__muted">You are approving as the Sift account saved in this browser.</p>
            </Show>
            <Show when={problem()}>
              <p class="error" role="alert">{problem()}</p>
            </Show>
            <div class="connect__actions">
              <button class="btn primary" disabled={busy()} onClick={() => void decide('approve')}>Allow</button>
              <button class="btn subtle" disabled={busy()} onClick={() => void decide('deny')}>Deny</button>
            </div>
            <p class="connect__muted">Only allow agents you started yourself. You can disconnect an agent at any time in Settings → Sync → Agent access.</p>
          </Match>
          <Match when={mode() === 'code'}>
            <h1>Connect {view()?.clientName} to your Sift?</h1>
            <ClientSummary view={view()!} />
            <Show when={view()?.approvalCode}>
              <div class="connect__code" aria-label="Approval code">{displayApprovalCode(view()!.approvalCode!)}</div>
              <div class="connect__actions connect__actions--center">
                <button class="btn" onClick={() => void copyCode()}>
                  {copied() ? <Check size={14} /> : <Copy size={14} />}
                  {copied() ? 'Copied' : 'Copy code'}
                </button>
              </div>
              <div class="connect__qr" innerHTML={renderSyncKeyQr(view()!.approvalCode!)} aria-label="QR code of the approval code" />
            </Show>
            <p>Open Sift on the device where you use it, go to Settings → Sync → Agent access → Approve a connection, and enter this code.</p>
            <p class="connect__muted">Approval needs Sift with sync turned on. This page continues by itself once you approve.</p>
            <Show when={problem()}>
              <p class="error" role="alert">{problem()}</p>
            </Show>
            <p class="connect__muted" role="status">Waiting for approval…</p>
          </Match>
        </Switch>
      </div>
    </main>
  );
}
