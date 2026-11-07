import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "Proofly_Project_Report.md"), "utf8");
const escape = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const inline = value => escape(value)
  .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\*([^*]+)\*/g, "<em>$1</em>");

const lines = source.split(/\r?\n/);
let body = "", paragraph = [], list = [], quote = [], table = [], inCode = false, code = [];
const flushParagraph = () => { if (paragraph.length) body += `<p>${inline(paragraph.join(" "))}</p>\n`; paragraph = []; };
const flushList = () => { if (list.length) body += `<ul>${list.map(item => `<li>${inline(item)}</li>`).join("")}</ul>\n`; list = []; };
const flushQuote = () => { if (quote.length) body += `<blockquote>${inline(quote.join(" "))}</blockquote>\n`; quote = []; };
const flushTable = () => {
  if (!table.length) return;
  const rows = table.map(row => row.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim()));
  const hasDivider = rows[1]?.every(cell => /^:?-{3,}:?$/.test(cell));
  const data = hasDivider ? rows.filter((_, index) => index !== 1) : rows;
  body += `<table>${data.map((row, index) => `<tr>${row.map(cell => `<${index === 0 ? "th" : "td"}>${inline(cell)}</${index === 0 ? "th" : "td"}>`).join("")}</tr>`).join("")}</table>\n`;
  table = [];
};
const flushAll = () => { flushParagraph(); flushList(); flushQuote(); flushTable(); };

for (const line of lines) {
  if (line.startsWith("```")) {
    flushAll();
    if (inCode) { body += `<pre><code>${escape(code.join("\n"))}</code></pre>\n`; code = []; }
    inCode = !inCode;
    continue;
  }
  if (inCode) { code.push(line); continue; }
  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) { flushAll(); const level = heading[1].length; body += `<h${level}>${inline(heading[2])}</h${level}>\n`; continue; }
  if (/^---+$/.test(line.trim())) { flushAll(); body += "<hr>\n"; continue; }
  if (/^>\s?/.test(line)) { flushParagraph(); flushList(); flushTable(); quote.push(line.replace(/^>\s?/, "")); continue; }
  if (/^-\s+/.test(line)) { flushParagraph(); flushQuote(); flushTable(); list.push(line.replace(/^-\s+/, "")); continue; }
  if (/^\|.*\|\s*$/.test(line)) { flushParagraph(); flushList(); flushQuote(); table.push(line); continue; }
  if (!line.trim()) { flushAll(); continue; }
  flushList(); flushQuote(); flushTable(); paragraph.push(line.trim());
}
flushAll();

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Proofly Project Report</title><style>
@page{size:A4;margin:17mm 18mm 18mm}*{box-sizing:border-box}html{font-family:Arial,Helvetica,sans-serif;color:#24212a;font-size:10.5pt;line-height:1.48}body{max-width:100%;margin:0}h1{font-size:28pt;line-height:1.12;color:#4b2b78;margin:18mm 0 10mm;border-bottom:4px solid #28a89c;padding-bottom:8mm}h2{font-size:19pt;line-height:1.2;color:#4b2b78;margin:12mm 0 5mm;break-after:avoid}h3{font-size:13.5pt;color:#26212d;margin:7mm 0 3mm;break-after:avoid}p{margin:0 0 3.7mm;text-align:justify;orphans:3;widows:3}strong{color:#2d2140}ul{margin:1mm 0 4mm 6mm;padding-left:5mm}li{margin:0 0 1.4mm}blockquote{margin:5mm 8mm;padding:4mm 6mm;border-left:4px solid #28a89c;background:#f1fbf8;color:#4b2b78;font-size:12pt;font-weight:700}code{font-family:Menlo,Consolas,monospace;background:#f2eff7;padding:.3mm 1mm;border-radius:2mm;font-size:9pt}pre{white-space:pre-wrap;background:#f5f3f8;padding:4mm;border-radius:3mm}table{width:100%;border-collapse:collapse;margin:4mm 0 6mm;break-inside:avoid;font-size:9.5pt}th{background:#4b2b78;color:#fff;text-align:left}th,td{padding:2.5mm 3mm;border:1px solid #d8d2e2;vertical-align:top}tr:nth-child(even) td{background:#f7f5fa}img{display:block;max-width:100%;height:auto;margin:6mm auto;break-inside:avoid}hr{border:0;border-top:1px solid #d7d1df;margin:7mm 0}.report-meta{font-size:12pt}.summary{background:linear-gradient(135deg,#f1edff,#eefbf7);border-radius:4mm;padding:5mm;margin-bottom:8mm}h1+ h2{margin-top:0}h2:first-of-type{font-size:16pt;color:#28212e}.footer-note{color:#6c6572;font-size:8.5pt}@media print{a{color:inherit;text-decoration:none}h2{page-break-after:avoid}h3{page-break-after:avoid}}
</style></head><body>${body}</body></html>`;
writeFileSync(resolve(root, "Proofly_Project_Report.html"), html);
console.log(resolve(root, "Proofly_Project_Report.html"));
