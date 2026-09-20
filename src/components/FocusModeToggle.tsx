import { Focus } from 'lucide-solid';
import { useApp } from '../state';

export function FocusModeToggle() {
  const ctx = useApp();
  const label = () => ctx.state.focusMode ? 'Disable focus mode' : 'Enable focus mode';

  return (
    <button
      class="focus-mode-toggle desktop-only"
      title={label()}
      aria-label={label()}
      aria-pressed={ctx.state.focusMode}
      onClick={() => {
        const focusMode = !ctx.state.focusMode;
        ctx.setState({ focusMode });
        void ctx.saveSettingsPatch({ focusMode });
      }}
    >
      <Focus size={14} />
    </button>
  );
}
