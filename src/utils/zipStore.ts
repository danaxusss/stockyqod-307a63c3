// A one-file ZIP archive without compression ("stored"), enough for the DGI
// portals that ask for the XML zipped (SIMPL délais de paiement). No library:
// the format is a local header, the data, a central directory and its end.

let table: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The bytes of a ZIP holding one file `name` with `content` (UTF-8). */
export function zipOneFile(name: string, content: string, date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const fileName = enc.encode(name);
  const data = enc.encode(content);
  const crc = crc32(data);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  // Bit 11: file name in UTF-8.
  const flags = 0x0800;

  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, flags, true);
  local.setUint16(8, 0, true);
  local.setUint16(10, dosTime, true);
  local.setUint16(12, dosDate, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, data.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, fileName.length, true);
  local.setUint16(28, 0, true);

  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint16(8, flags, true);
  central.setUint16(10, 0, true);
  central.setUint16(12, dosTime, true);
  central.setUint16(14, dosDate, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, data.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, fileName.length, true);
  central.setUint16(30, 0, true);
  central.setUint16(32, 0, true);
  central.setUint16(34, 0, true);
  central.setUint16(36, 0, true);
  central.setUint32(38, 0, true);
  central.setUint32(42, 0, true);

  const localSize = 30 + fileName.length + data.length;
  const centralSize = 46 + fileName.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, localSize, true);
  end.setUint16(20, 0, true);

  const out = new Uint8Array(localSize + centralSize + 22);
  let o = 0;
  const put = (b: Uint8Array) => { out.set(b, o); o += b.length; };
  put(new Uint8Array(local.buffer)); put(fileName); put(data);
  put(new Uint8Array(central.buffer)); put(fileName);
  put(new Uint8Array(end.buffer));
  return out;
}

/** Offer bytes or text as a download. */
export function downloadBlob(content: BlobPart, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
