/** Format an ISO date string as a short relative time ("just now", "5m ago", "3h ago", "2d ago"). */
export function formatRelativeTime(isoDate: string, now?: Date): string {
  if (Number.isNaN(Date.parse(isoDate))) {
    throw new RangeError(`Invalid date string: ${isoDate}`);
  }
  const ref = now ?? new Date();
  const date = parseDate(isoDate);
  const seconds = Math.round((ref.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function parseDate(isoDate: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(isoDate);
}
