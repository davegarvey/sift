const ACTIVITY_TIMEOUT_MS = 5 * 60_000;

let lastActivity = Date.now();
let wasEverActive = false;
let catchupFns: Array<() => void> = [];

export function onCatchup(fn: () => void): void {
  catchupFns.push(fn);
}

function fireCatchup(): void {
  const fns = catchupFns;
  catchupFns = [];
  for (const fn of fns) fn();
}

export function isIdle(): boolean {
  return Date.now() - lastActivity > ACTIVITY_TIMEOUT_MS;
}

export function markActive(): void {
  const wasIdle = wasEverActive && isIdle();
  lastActivity = Date.now();
  wasEverActive = true;
  if (wasIdle) fireCatchup();
}

export function clearActivityOnHide(): void {
  lastActivity = Date.now();
  wasEverActive = false;
}

const EVENTS = [
  'mousemove', 'mousedown', 'keydown', 'touchstart',
  'click', 'wheel', 'pointerdown',
] as const;

for (const ev of EVENTS) {
  document.addEventListener(ev, markActive, { passive: true });
}

document.addEventListener('scroll', markActive, { capture: true, passive: true });
