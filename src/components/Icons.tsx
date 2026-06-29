import { Circle, CircleCheck, CircleQuestionMark, RefreshCw } from 'lucide-solid';

export function HelpIcon() {
  return <CircleQuestionMark size={14} />;
}

export function RefreshIcon(props: { spinning: boolean }) {
  return (
    <RefreshCw
      size={14}
      class={props.spinning ? 'refresh-icon-spinning' : ''}
    />
  );
}

export function CircleIcon() {
  return <Circle size={14} />;
}

export function CircleCheckIcon() {
  return <CircleCheck size={14} />;
}
