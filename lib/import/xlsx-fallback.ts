import JSZip from "jszip";

/**
 * Robuster XLSX-Reader für Files, die ExcelJS nicht parst (z. B. mit
 * x:-Namespace-Präfix, wie sie openpyxl/Python und manche Bazaraki-Exports
 * erzeugen). Liest Cells direkt aus den Sheet-XMLs via JSZip + Regex.
 *
 * Liefert pro Sheet eine grobe text/CSV-Repräsentation, die Claude (Sonnet)
 * als Freitext interpretieren kann.
 */

type Cell = { col: number; row: number; value: string };

export type XlsxSheet = {
  name: string;
  rows: string[][];
};

export async function readXlsxRaw(buffer: ArrayBuffer): Promise<XlsxSheet[]> {
  const zip = await JSZip.loadAsync(buffer);

  // Shared Strings (häufig leer, wenn Cells inline t="str" verwenden)
  const sharedStrings = await readSharedStrings(zip);

  // Workbook → Sheet-Reihenfolge + Namen
  const workbookXml = await zip.file("xl/workbook.xml")?.async("text");
  const sheetMeta = workbookXml ? parseSheetMeta(workbookXml) : [];

  // Workbook-Rels → Mapping rId → target file
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("text");
  const rels = relsXml ? parseRels(relsXml) : {};

  const sheets: XlsxSheet[] = [];
  for (const meta of sheetMeta) {
    const target = rels[meta.rId];
    if (!target) continue;
    const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheetXml = await zip.file(sheetPath)?.async("text");
    if (!sheetXml) continue;
    sheets.push({
      name: meta.name,
      rows: parseSheetRows(sheetXml, sharedStrings),
    });
  }

  // Fallback: wenn die Rels-Auflösung schiefging, nimm alle sheet*.xml direkt
  if (sheets.length === 0) {
    const sheetFiles = Object.keys(zip.files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort();
    for (const path of sheetFiles) {
      const sheetXml = await zip.file(path)!.async("text");
      sheets.push({
        name: path.replace(/^.*\//, "").replace(".xml", ""),
        rows: parseSheetRows(sheetXml, sharedStrings),
      });
    }
  }

  return sheets;
}

async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const ssFile = zip.file("xl/sharedStrings.xml");
  if (!ssFile) return [];
  const xml = await ssFile.async("text");
  // <(x:)?si>(<(x:)?t>...</(x:)?t>|<(x:)?r><(x:)?t>...</(x:)?t></(x:)?r>+)</(x:)?si>
  const out: string[] = [];
  const siRegex = /<(?:[a-z]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml)) !== null) {
    const inner = match[1];
    // Alle <t>-Inhalte sammeln (für rich text mehrere)
    const parts: string[] = [];
    const tRegex = /<(?:[a-z]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tRegex.exec(inner)) !== null) {
      parts.push(decodeXml(tm[1]));
    }
    out.push(parts.join(""));
  }
  return out;
}

function parseSheetMeta(workbookXml: string): { name: string; rId: string }[] {
  const out: { name: string; rId: string }[] = [];
  const sheetRegex = /<(?:[a-z]+:)?sheet\b([^/]*?)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = sheetRegex.exec(workbookXml)) !== null) {
    const attrs = match[1];
    const nameMatch = /\bname="([^"]+)"/.exec(attrs);
    const ridMatch = /\br:id="([^"]+)"/.exec(attrs);
    if (nameMatch && ridMatch) {
      out.push({ name: decodeXml(nameMatch[1]), rId: ridMatch[1] });
    }
  }
  return out;
}

function parseRels(relsXml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const relRegex = /<Relationship\b([^/]*?)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = relRegex.exec(relsXml)) !== null) {
    const attrs = match[1];
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (id && target) out[id] = target;
  }
  return out;
}

function parseSheetRows(sheetXml: string, sharedStrings: string[]): string[][] {
  const cells: Cell[] = [];
  // <c r="A1" t="str|s|inlineStr|n|b"><v>..</v></c> oder
  // <c r="A1" t="inlineStr"><is><t>..</t></is></c>
  const cellRegex = /<(?:[a-z]+:)?c\b([^>]*?)(\/>|>([\s\S]*?)<\/(?:[a-z]+:)?c>)/g;
  let match: RegExpExecArray | null;
  while ((match = cellRegex.exec(sheetXml)) !== null) {
    const attrs = match[1];
    const inner = match[3] ?? "";
    const ref = /\br="([A-Z]+)(\d+)"/.exec(attrs);
    if (!ref) continue;
    const col = colLetterToIndex(ref[1]);
    const row = parseInt(ref[2], 10) - 1;
    const t = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";

    let value = "";
    const vMatch = /<(?:[a-z]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?v>/.exec(inner);
    const isMatch = /<(?:[a-z]+:)?is\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?is>/.exec(inner);

    if (t === "s" && vMatch) {
      const idx = parseInt(vMatch[1], 10);
      value = sharedStrings[idx] ?? "";
    } else if (t === "inlineStr" && isMatch) {
      const tInner = /<(?:[a-z]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[a-z]+:)?t>/.exec(isMatch[1]);
      value = tInner ? decodeXml(tInner[1]) : "";
    } else if (vMatch) {
      value = decodeXml(vMatch[1]);
    }

    if (value !== "") cells.push({ col, row, value });
  }

  if (cells.length === 0) return [];

  const maxRow = Math.max(...cells.map((c) => c.row));
  const maxCol = Math.max(...cells.map((c) => c.col));
  const grid: string[][] = [];
  for (let r = 0; r <= maxRow; r++) {
    grid.push(new Array(maxCol + 1).fill(""));
  }
  for (const c of cells) {
    grid[c.row][c.col] = c.value;
  }
  // Leere Zeilen am Ende strippen
  while (grid.length > 0 && grid[grid.length - 1].every((v) => !v.trim())) {
    grid.pop();
  }
  return grid;
}

function colLetterToIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&");
}

/**
 * Wählt das Sheet mit den meisten Datenzeilen — typisch das eigentliche
 * Listings-Sheet, nicht das Summary/Cover-Sheet.
 */
export function pickPrimarySheet(sheets: XlsxSheet[]): XlsxSheet | null {
  const candidates = sheets.filter((s) => s.rows.length > 1);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.rows.length - a.rows.length);
  return candidates[0];
}

/**
 * Konvertiert Sheet-Rows in den Header+Rows-Form, den der bestehende
 * Tabellen-Pfad erwartet. Heuristik: erste nicht-leere Zeile mit ≥2 nicht-
 * leeren Zellen ist der Header.
 */
export function rowsToHeaderRecords(sheet: XlsxSheet): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const data = sheet.rows;
  let headerIdx = -1;
  for (let i = 0; i < data.length; i++) {
    const nonEmpty = data[i].filter((v) => v && v.trim()).length;
    if (nonEmpty >= 2) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { headers: [], rows: [] };
  const headers = data[headerIdx].map((h, i) => h.trim() || `col_${i + 1}`);
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < data.length; i++) {
    const r = data[i];
    if (r.every((v) => !v || !v.trim())) continue;
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      const v = r[idx];
      if (v && v.trim()) record[h] = v.trim();
    });
    if (Object.keys(record).length > 0) rows.push(record);
  }
  return { headers, rows };
}
