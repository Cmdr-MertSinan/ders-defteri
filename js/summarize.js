const Summarize = (() => {
  const SKIP =
    /^(sayfa|page)?\s*\d+$|^\d+\s*\/\s*\d+$|copyright|tüm hakları|all rights/i;

  function median(values) {
    if (!values.length) return 12;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  function cleanPoint(text) {
    return text.replace(/^[-•●▪►▸○]\s*/, "").replace(/\s+/g, " ").trim();
  }

  function repeatingLines(pages) {
    const counts = new Map();
    for (const page of pages) {
      const seen = new Set();
      for (const line of page.lines) {
        const key = cleanPoint(line.text).toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    const threshold = Math.max(4, Math.ceil(pages.length * 0.7));
    const skip = new Set();
    for (const [key, count] of counts) {
      if (count >= threshold && key.length < 80) skip.add(key);
    }
    return skip;
  }

  function isHeading(line, midSize) {
    const text = line.text;
    if (!text || text.length > 110 || SKIP.test(text)) return false;
    if (line.size >= midSize * 1.18) return true;
    if (/^(hafta|konu|ünite|bölüm|unit|chapter|week)\b/i.test(text)) return true;
    if (/^\d+([.)]|-)(\s|$)/.test(text) && text.length < 80) return true;
    const letters = text.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü]/g, "");
    return letters.length > 3 && text === text.toUpperCase() && text.length < 80;
  }

  function build(pages) {
    const repeated = repeatingLines(pages);
    const sections = [];

    for (const page of pages) {
      const sizes = page.lines.map((line) => line.size);
      const mid = median(sizes);
      const useful = page.lines
        .map((line) => ({ ...line, text: cleanPoint(line.text) }))
        .filter((line) => {
          const key = line.text.toLowerCase();
          return line.text.length > 1 && !SKIP.test(line.text) && !repeated.has(key);
        });
      if (!useful.length) continue;

      const titleLine =
        useful.find((line) => isHeading(line, mid)) ||
        useful.slice().sort((a, b) => b.size - a.size)[0] ||
        useful[0];

      const heading = titleLine.text;
      const points = [];
      for (const line of useful) {
        if (line.text === heading) continue;
        if (line.text.length < 3) continue;
        if (points.some((point) => point.toLowerCase() === line.text.toLowerCase())) continue;
        if (points.length < 16) points.push(line.text);
      }

      sections.push({
        heading,
        page: page.page,
        source: page.source || "",
        points,
      });
    }

    return sections;
  }

  return { build };
})();
