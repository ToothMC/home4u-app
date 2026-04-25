import Papa from "papaparse";
import { pickPrimarySheet, readXlsxRaw, rowsToHeaderRecords } from "./xlsx-fallback";

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS = 5000;
export const MAX_TEXT_CHARS = 200_000;

export type ParsedFormat = "csv" | "xlsx" | "pdf" | "text";

/**
 * Strukturierte Eingabe: Zeilen mit Header-Map (CSV/XLSX).
 * Unstrukturierte Eingabe: ein String, AI muss daraus Listings extrahieren (PDF/Text/Markdown).
 */
export type ParseResult =
  | { kind: "rows"; format: "csv" | "xlsx"; headers: string[]; rows: Record<string, string>[] }
  | { kind: "text"; format: "pdf" | "text"; text: string; pageCount?: number };

export class ParseError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "ParseError";
  }
}

export async function parseUpload(buffer: ArrayBuffer, fileName: string): Promise<ParseResult> {
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new ParseError(
      `Datei zu groß (max ${MAX_FILE_SIZE / 1024 / 1024} MB)`,
      "file_too_large"
    );
  }

  const lower = fileName.toLowerCase();

  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    return parseXlsx(buffer);
  }
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) {
    return parseCsv(buffer);
  }
  if (lower.endsWith(".pdf")) {
    return parsePdf(buffer);
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".text")) {
    return parseText(buffer);
  }

  // Heuristik per Inhalt: BOM/CSV oder Plain-Text
  const text = new TextDecoder("utf-8").decode(buffer.slice(0, 4096));
  if (text.includes(",") || text.includes(";") || text.includes("\t")) {
    return parseCsv(buffer);
  }
  return parseText(buffer);
}

function parseCsv(buffer: ArrayBuffer): ParseResult {
  const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });

  if (result.errors.length > 0) {
    const fatal = result.errors.filter(
      (e) => e.code !== "TooFewFields" && e.code !== "TooManyFields"
    );
    if (fatal.length > 0) {
      throw new ParseError(`CSV-Parse-Fehler: ${fatal[0].message}`, "csv_parse_error");
    }
  }

  const headers = (result.meta.fields ?? []).map((h) => h.trim()).filter(Boolean);
  const rows = result.data.filter((r) =>
    Object.values(r).some((v) => v && String(v).trim())
  );

  if (rows.length > MAX_ROWS) {
    throw new ParseError(`Zu viele Zeilen (max ${MAX_ROWS})`, "too_many_rows");
  }

  return { kind: "rows", format: "csv", headers, rows };
}

async function parseXlsx(buffer: ArrayBuffer): Promise<ParseResult> {
  // Versuch 1: ExcelJS (schnell, funktioniert für Standard-Excel/LibreOffice)
  try {
    const result = await parseXlsxViaExcelJS(buffer);
    if (result.headers.length > 0 || result.rows.length > 0) {
      if (result.rows.length > MAX_ROWS) {
        throw new ParseError(`Zu viele Zeilen (max ${MAX_ROWS})`, "too_many_rows");
      }
      return { kind: "rows", format: "xlsx", ...result };
    }
  } catch (err) {
    if (err instanceof ParseError) throw err;
    // ExcelJS schluckt Files mit x:-Namespace-Präfix (openpyxl/Bazaraki) → fallback
    console.warn("[parser] ExcelJS failed, falling back to raw XLSX reader:", err);
  }

  // Versuch 2: Raw-XML-Reader (deckt openpyxl, Python-erzeugte XLSX, etc.)
  const sheets = await readXlsxRaw(buffer);
  const primary = pickPrimarySheet(sheets);
  if (!primary) {
    throw new ParseError("Keine Datentabelle in der Excel-Datei gefunden", "empty_workbook");
  }
  const { headers, rows } = rowsToHeaderRecords(primary);
  if (headers.length === 0 || rows.length === 0) {
    throw new ParseError(
      "Excel-Datei enthält keine erkennbare Datentabelle (Header + Zeilen)",
      "no_data_table"
    );
  }
  if (rows.length > MAX_ROWS) {
    throw new ParseError(`Zu viele Zeilen (max ${MAX_ROWS})`, "too_many_rows");
  }
  return { kind: "rows", format: "xlsx", headers, rows };
}

async function parseXlsxViaExcelJS(buffer: ArrayBuffer) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Sheet mit den meisten Datenzeilen wählen (skippt Cover/Summary-Sheets)
  let sheet = workbook.worksheets[0];
  for (const ws of workbook.worksheets) {
    if (ws.rowCount > (sheet?.rowCount ?? 0)) sheet = ws;
  }
  if (!sheet) return { headers: [], rows: [] as Record<string, string>[] };

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });
  const cleanHeaders = headers.filter(Boolean);

  const rows: Record<string, string>[] = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const record: Record<string, string> = {};
    let hasContent = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      const cell = row.getCell(idx + 1);
      const v = cellToString(cell.value);
      if (v) hasContent = true;
      record[h] = v;
    });
    if (hasContent) rows.push(record);
  }

  return { headers: cleanHeaders, rows };
}

async function parsePdf(buffer: ArrayBuffer): Promise<ParseResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    let text = result.text ?? "";
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
    }
    return {
      kind: "text",
      format: "pdf",
      text,
      pageCount: result.pages?.length ?? undefined,
    };
  } finally {
    await parser.destroy();
  }
}

function parseText(buffer: ArrayBuffer): ParseResult {
  let text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  return { kind: "text", format: "text", text };
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const obj = value as {
      result?: unknown;
      text?: unknown;
      richText?: Array<{ text?: string }>;
      hyperlink?: string;
    };
    if (obj.result !== undefined && obj.result !== null) return cellToString(obj.result);
    if (obj.text) return String(obj.text).trim();
    if (Array.isArray(obj.richText))
      return obj.richText.map((r) => r.text ?? "").join("").trim();
    if (obj.hyperlink) return String(obj.hyperlink).trim();
  }
  return String(value).trim();
}
