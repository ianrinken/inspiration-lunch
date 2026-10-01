/* Reads a school supply-list PDF into sections, so the app can show a
 * child just their grade (elementary) or their classes and activities
 * (middle school) instead of the whole sheet.
 *
 * The schools lay these out differently: boxes in columns with a heading
 * on top, bands with a sideways grade label on the left, or subject
 * columns. We read the text with positions, find the headings (the
 * bigger text), work out which layout it is, hand each line to its
 * heading, and re-join lines the PDF wrapped. Facts, from the school's
 * own document. */

function gradeOf(title) {
  const t = title.toLowerCase().replace(/\s+/g, " ").trim();
  if (/jr\.?\s*k|junior k|pre-?k/.test(t)) return -1;
  if (/^k\b|kind/.test(t)) return 0;
  const m = t.match(/(\d)(?:st|nd|rd|th)/);
  if (m) return +m[1];
  const words = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  for (let i = 0; i < words.length; i++) if (t.includes(words[i])) return i + 1;
  return null;
}
const tidy = (s) => s.replace(/[\u200B\uFEFF\u00AD]/g, "").replace(/\s+/g, " ").replace(/\s([,.)])/g, "$1").replace(/\(\s/g, "(").trim();
const TITLE = /supply list|^\d{4}\s*-\s*\d{2,4}|^\d{4}-\d{4}/i;

// Join text pieces that sit on the same baseline, left to right. A tiny
// gap means the PDF split a word ("P" + "laydoh").
function mergeLines(items, tol) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const i of sorted) {
    const last = lines[lines.length - 1];
    // Same baseline and close enough to be the same line; a big gap is
    // the next column over.
    const itemStart = (/^\s*\(?\d+\)?\s*[-–]?\s+\S/.test(i.s) || /^\s*\(?\d+\)?\s*[-–]?\s*$/.test(i.s)) && /^\s*\(?\d/.test(last ? last.s : "") && last && last.s.trim().length > 6;
    if (last && !itemStart && Math.abs(last.y - i.y) <= tol && i.x >= last.xEnd - 3 && i.x - last.xEnd < Math.max(8, last.h * 1.2)) {
      last.s += (i.x - last.xEnd > 1.5 ? " " : "") + i.s;
      last.xEnd = i.x + i.w; last.h = Math.max(last.h, i.h);
    } else {
      lines.push({ s: i.s, x: i.x, y: i.y, h: i.h, xEnd: i.x + i.w });
    }
  }
  return lines;
}

async function parseSupplyPdf(bytes, debug = false) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
  const sections = [];
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ s: i.str.replace(/[\u200B\uFEFF\u00AD]/g, ""), x: i.transform[4], y: vp.height - i.transform[5], h: Math.round(i.height) || 10, w: i.width || i.str.length * 5 }))
      .filter((i) => i.s.trim());
    if (!items.length) continue;

    // Body text is the most common size; headings are clearly bigger.
    const hs = {};
    items.forEach((i) => { hs[i.h] = (hs[i.h] || 0) + 1; });
    const body = +Object.keys(hs).sort((a, b) => hs[b] - hs[a])[0];
    const lines = mergeLines(items, 3);
    // Headings are short; a long sentence in big text is a note.
    let heads = lines.filter((l) => l.h >= body + 2 && l.s.trim().length > 1 && l.s.trim().length <= 45 && !TITLE.test(l.s));
    if (!heads.length) continue;

    const secs = heads.map((h) => ({ title: tidy(h.s), grade: gradeOf(h.s), x: h.x, y: h.y, lines: [] }));
    const bodyLines = lines.filter((l) => !heads.includes(l) && !TITLE.test(l.s));

    // Columns: the lists are left-aligned, so the x's where many lines
    // start are the column lefts. Group starts (20px tolerance), keep the
    // dense groups, merge any two closer than a sixth of the page.
    const starts = bodyLines.map((l) => Math.round(l.x)).sort((a, b) => a - b);
    const groups = [];
    for (const x of starts) {
      const g = groups[groups.length - 1];
      if (g && x - g.max <= 20) { g.max = x; g.n++; } else groups.push({ min: x, max: x, n: 1 });
    }
    const dense = groups.filter((g) => g.n >= Math.max(3, bodyLines.length * 0.08));
    const lefts = [];
    for (const g of dense) { if (lefts.length && g.min - lefts[lefts.length - 1] < vp.width / 6) continue; lefts.push(g.min); }
    if (!lefts.length) lefts.push(groups[0].min);
    // A line belongs to the last column left at or before its start (with
    // a little slack for indented lines); a heading to the one nearest.
    const colOf = (x) => { let c = 0; lefts.forEach((lx, i) => { if (x >= lx - 12) c = i; }); return c; };
    const lineCol = colOf;
    const hx = [...new Set(heads.map((h) => Math.round(h.x)))].sort((a, b) => a - b);
    const hcols = new Set(heads.map((h) => colOf(h.x)));

    // Bands: every heading in ONE column, stacked down the page. A label
    // in the left margin sits beside its items (split midway between
    // labels); a heading over its band owns everything down to the next.
    const bands = hcols.size === 1 && heads.length > 1 && lefts.length > 1 || (heads.length > 1 && Math.max(...hx) - Math.min(...hx) < 40);
    const inMargin = bands && Math.min(...hx) < vp.width * 0.15;
    if (debug) console.log("body", body, "bands", bands, inMargin ? "(margin labels)" : "", "lefts", JSON.stringify(lefts), "heads", heads.map((h) => `${h.s}@${Math.round(h.x)},${Math.round(h.y)}h${h.h}→c${colOf(h.x)}`).join(" | "));

    let ownerOf;
    if (bands) {
      const sorted = [...secs].sort((a, b) => a.y - b.y);
      const edges = sorted.map((sec, i) => (i ? (inMargin ? (sorted[i - 1].y + sec.y) / 2 : sec.y - 2) : -Infinity));
      ownerOf = (l) => { let o = null; sorted.forEach((sec, i) => { if (l.y >= edges[i]) o = sec; }); return o; };
    } else {
      secs.forEach((sec) => { sec.col = colOf(sec.x); });
      ownerOf = (l) => { const c = colOf(l.x); let o = null; for (const sec of secs) if (sec.col === c && sec.y < l.y + 2 && (!o || sec.y > o.y)) o = sec; return o; };
    }

    // Read each section column by column, top to bottom.
    const ordered = bodyLines.map((l) => ({ l, owner: ownerOf(l), col: lineCol(l.x) })).filter((o) => o.owner)
      .sort((a, b) => a.col - b.col || a.l.y - b.l.y);
    let rawPrev = "";
    for (const { l, owner } of ordered) {
      const text = tidy(l.s);
      if (!text || /^updated:/i.test(text)) continue;
      const prev = owner.lines[owner.lines.length - 1];
      // A wrapped continuation: starts lowercase, or the line just before
      // it (the raw one, so a missing ")" can't swallow a whole column)
      // was left open or ended on a joiner. Never a line that starts like
      // a new item.
      const open = (rawPrev.match(/\(/g) || []).length > (rawPrev.match(/\)/g) || []).length;
      const newItem = /^\(?\d/.test(text);
      const cont = prev && !newItem && (/^[a-z]/.test(text) || open || /[,&/-]$|\b(?:with|and|or|for|of|the|a|an|no|in)$/i.test(rawPrev));
      if (cont) owner.lines[owner.lines.length - 1] = tidy(`${prev} ${text}`);
      else owner.lines.push(text);
      rawPrev = text;
    }
    for (const sec of secs.sort((a, b) => a.y - b.y)) sections.push({ title: sec.title, grade: sec.grade, lines: sec.lines });
  }
  // On a grade-by-grade sheet, big text that isn't a grade is a boxed
  // note ("All students need tennis shoes for PE"), often split over
  // several lines: carry it as one note.
  const graded = sections.some((sec) => sec.grade !== null);
  const notes = graded
    ? [tidy(sections.filter((sec) => sec.grade === null && !/elementary|school district|middle school|high school/i.test(sec.title)).map((sec) => `${sec.title} ${sec.lines.join(" ")}`).join(" "))].filter(Boolean)
    : [];
  const kept = (graded ? sections.filter((sec) => sec.grade !== null) : sections).filter((sec) => sec.lines.length);
  return { sections: kept, notes };
}

module.exports = { parseSupplyPdf, gradeOf };
