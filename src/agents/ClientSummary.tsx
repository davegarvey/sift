import { Show } from 'solid-js';
import { CircleAlert } from 'lucide-solid';
import { accessSummary, type AccessView } from './approval';

export function ClientSummary(props: { view: Pick<AccessView, 'clientName' | 'unverified' | 'clientHost' | 'redirectHost' | 'scopes'> }) {
  return (
    <div class="client-summary">
      <div class="client-summary__name">
        <span>{props.view.clientName}</span>
        <Show when={props.view.unverified}>
          <span class="unverified-mark" title="This name was supplied by the app itself and has not been checked">
            <CircleAlert size={12} />
            unverified
          </span>
        </Show>
      </div>
      <dl class="client-summary__facts">
        <Show when={props.view.clientHost}>
          <dt>Website</dt>
          <dd>{props.view.clientHost}</dd>
        </Show>
        <dt>Returns to</dt>
        <dd>{props.view.redirectHost}</dd>
        <dt>Access</dt>
        <dd>{accessSummary(props.view.scopes)}</dd>
      </dl>
    </div>
  );
}
