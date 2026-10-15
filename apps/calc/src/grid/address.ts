// A1-style addresses.

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colName(col: number): string {
  let s = "";
  let c = col + 1;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

export function cellAddress(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

/** Quotes a sheet name for a reference when needed (`'My Sheet'!A1`). */
export function sheetPrefix(name: string): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name);
  return plain ? `${name}!` : `'${name.replace(/'/g, "''")}'!`;
}
