/** Saves a file in the browser. */
export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked later: some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The bytes of an uploaded file (FileReader where Blob.arrayBuffer is missing). */
export function readFileBytes(f: Blob): Promise<Uint8Array> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer().then(b => new Uint8Array(b));
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(f);
  });
}
