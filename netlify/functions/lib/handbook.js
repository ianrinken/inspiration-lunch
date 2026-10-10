/* The district's student handbooks, read out of their PDFs into sections
 * the app can show and search. Each handbook opens with an alphabetical
 * table of contents in capitals; those entries are the section titles,
 * and each title reappears as its own line where the section starts.
 */

// Titles here; the PDF addresses live in data.js (DISTRICT.handbooks) so the
// app and this reader can never disagree about which file is which.
const TITLES = {
  district: "District handbook",
  elementary: "Elementary handbook",
  intermediate: "Intermediate handbook",
  middle: "Middle School handbook",
  high: "High School handbook",
  activities: "Activities handbook",
};
const HANDBOOKS = Object.fromEntries(Object.entries(require("../../../data.js").DISTRICT.handbooks).map(([k, url]) => [k, [TITLES[k] || `${k} handbook`, url]]));

// Glyphs the PDF fonts mislabel (ligatures) and spacing clean-up.
const GLYPHS = { "ƞ": "tf", "Ɵ": "ti", "Ʃ": "tt", "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "­": "", "​": "", "﻿": "" };
const fix = (s) => s.replace(/[ƞƟƩﬀﬁﬂﬃﬄ­​﻿]/g, (c) => GLYPHS[c]).replace(/\s+/g, " ").trim();

async function extractLines(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false, verbosity: 0 }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim())
      .map((i) => ({ s: i.str, x: i.transform[4], y: Math.round(i.transform[5]) }));
    // Same baseline (within 2pt) = same line; left to right.
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    let cur = null;
    for (const it of items) {
      if (cur && Math.abs(cur.y - it.y) <= 2) { cur.parts.push(it); continue; }
      if (cur) lines.push(cur);
      cur = { y: it.y, parts: [it], page: p };
    }
    if (cur) lines.push(cur);
  }
  return lines.map((l) => ({ page: l.page, text: fix(l.parts.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ")) })).filter((l) => l.text);
}

const norm = (s) => fix(s).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const TOC_RX = /^(.+?)\s*(?:\.{3,}|…+)\s*\d{1,3}$/;

// Section titles from the table of contents, then the body cut at each.
function sectionize(lines) {
  const titles = [];
  let tocEnd = -1;
  lines.slice(0, 140).forEach((l, i) => {
    const m = l.text.match(TOC_RX);
    if (m && /[A-Z]{3}/.test(m[1]) && m[1] === m[1].toUpperCase() ? true : m && m[1].length > 2 && /^[A-Z0-9]/.test(m[1])) {
      const t = m[1].replace(/\s*\.*\s*$/, "").trim();
      if (t.length >= 3 && t.length <= 90) { titles.push(t); tocEnd = i; }
    }
  });
  if (titles.length < 3) return { titles: [], sections: [{ title: "Handbook", text: lines.map((l) => l.text).join("\n") }] };
  const wanted = new Map(titles.map((t) => [norm(t), t]));
  const sections = [];
  let cur = { title: "About this handbook", lines: [] };
  const body = lines.slice(tocEnd + 1);
  for (const l of body) {
    const n = norm(l.text);
    const hit = wanted.get(n);
    if (hit && l.text.length <= 100) { if (cur.lines.length) sections.push(cur); cur = { title: hit, lines: [] }; continue; }
    // Page furniture: bare page numbers and running headers.
    if (/^\d{1,3}$/.test(l.text) || /^(brandon valley|page \d)/i.test(l.text)) continue;
    cur.lines.push(l.text);
  }
  if (cur.lines.length) sections.push(cur);
  return {
    titles,
    sections: sections
      .map((s) => ({ title: s.title, text: paragraphs(s.lines) }))
      .filter((s) => s.text.length > 20),
  };
}

// Lines back into paragraphs: bullets and headings stand alone, wrapped
// sentences join up.
function paragraphs(lines) {
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    const bullet = /^[•·▪●o\-–]\s|^\(?[a-z0-9]{1,2}[.)]\s/i.test(t);
    const heading = t.length < 60 && t === t.toUpperCase() && /[A-Z]{3}/.test(t);
    const prev = out[out.length - 1];
    if (prev && !bullet && !heading && !prev.heading && !/[.:;!?]$/.test(prev.text) && /^[a-z(,]/.test(t)) { prev.text += " " + t; continue; }
    if (prev && !bullet && !heading && !prev.heading && !prev.bullet && !/[.:;!?]$/.test(prev.text)) { prev.text += " " + t; continue; }
    out.push({ text: t, bullet, heading });
  }
  return out.map((p) => p.text).join("\n");
}

async function parseHandbook(bytes) {
  return sectionize(await extractLines(bytes));
}

module.exports = { HANDBOOKS, parseHandbook, sectionize, extractLines };
