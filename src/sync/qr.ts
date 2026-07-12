/**
 * QR code rendering for the sync key. Wraps the `qrcode-generator` library.
 *
 * For 22-character base64url keys, error correction level M, this produces
 * a small (version 3) QR code that fits in a ~200×200 px display.
 */

import qrcode from 'qrcode-generator';

export function renderSyncKeyQr(syncKey: string, cellSize = 6, margin = 2): string {
  const qr = (qrcode as unknown as (type: number, ec: 'L' | 'M' | 'Q' | 'H') => {
    addData: (s: string) => void;
    make: () => void;
    getModuleCount: () => number;
    isDark: (r: number, c: number) => boolean;
  })(0, 'M');
  qr.addData(syncKey);
  qr.make();
  const count = qr.getModuleCount();
  const size = count * cellSize + margin * 2 * cellSize;
  let cells = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        cells += `<rect x="${margin * cellSize + c * cellSize}" y="${margin * cellSize + r * cellSize}" width="${cellSize}" height="${cellSize}" />`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" fill="currentColor">${cells}</svg>`;
}
