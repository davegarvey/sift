export function publicOrigin(requestUrl: string, publicUrl?: string): string {
  return (publicUrl ? new URL(publicUrl) : new URL(requestUrl)).origin;
}
