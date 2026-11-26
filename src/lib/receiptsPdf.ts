// Builds one PDF of every receipt in a report period, in date order:
// PDF receipts are copied page by page, image receipts get a page each.
// Runs entirely on this computer (pdf-lib), no online services.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface ReceiptRef {
  date: string;
  description: string;
  amount: string; // already formatted
  file: string; // vault path
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function buildReceiptsPdf(
  title: string,
  receipts: ReceiptRef[],
  readBase64: (path: string) => Promise<string | null>,
): Promise<{ bytes: Uint8Array; missing: string[] }> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const missing: string[] = [];

  // Cover page listing every receipt.
  let page = out.addPage([612, 792]);
  let y = 740;
  page.drawText(title, { x: 54, y, size: 18, font: bold });
  y -= 30;
  for (const r of receipts) {
    if (y < 60) { page = out.addPage([612, 792]); y = 740; }
    page.drawText(`${r.date}   ${r.description.slice(0, 60)}   ${r.amount}`, { x: 54, y, size: 10, font });
    y -= 16;
  }

  for (const r of receipts) {
    const b64 = await readBase64(r.file).catch(() => null);
    if (!b64) { missing.push(r.file); continue; }
    const bytes = b64ToBytes(b64);
    const ext = r.file.split(".").pop()?.toLowerCase() ?? "";
    const caption = `${r.date} · ${r.description} · ${r.amount}`;
    try {
      if (ext === "pdf") {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p, i) => {
          out.addPage(p);
          if (i === 0) p.drawText(caption.slice(0, 90), { x: 20, y: 12, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
        });
      } else if (ext === "png" || ext === "jpg" || ext === "jpeg") {
        const img = ext === "png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const p = out.addPage([612, 792]);
        const scale = Math.min(504 / img.width, 660 / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        p.drawText(caption.slice(0, 90), { x: 54, y: 750, size: 10, font: bold });
        p.drawImage(img, { x: (612 - w) / 2, y: 730 - h, width: w, height: h });
      } else {
        missing.push(r.file); // HEIC, WEBP and other formats can't be embedded
      }
    } catch {
      missing.push(r.file);
    }
  }
  return { bytes: await out.save(), missing };
}
