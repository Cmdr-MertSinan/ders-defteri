const Extract = (() => {
  function setupPdf() {
    if (!window.pdfjsLib) throw new Error("PDF.js yüklenemedi.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }

  function groupLines(items) {
    const lines = [];
    for (const item of items) {
      const y = Math.round((item.transform[5] || 0) * 2) / 2;
      const x = item.transform[4] || 0;
      const size = item.height || item.transform[0] || 12;
      const str = (item.str || "").trim();
      if (!str) continue;
      let line = lines.find((l) => Math.abs(l.y - y) < size * 0.45);
      if (!line) {
        line = { y, size, parts: [] };
        lines.push(line);
      }
      line.parts.push({ x, str, size });
      line.size = Math.max(line.size, size);
    }
    lines.sort((a, b) => b.y - a.y);
    return lines.map((line) => {
      line.parts.sort((a, b) => a.x - b.x);
      return {
        text: line.parts
          .map((p) => p.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
        size: line.size,
        y: line.y,
      };
    });
  }

  function copyData(buffer) {
    return buffer instanceof Uint8Array ? buffer.slice() : new Uint8Array(buffer);
  }

  async function openPdf(buffer) {
    setupPdf();
    return pdfjsLib.getDocument({ data: copyData(buffer) }).promise;
  }

  async function fromPdf(buffer) {
    const pdf = await openPdf(buffer);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push({ page: i, lines: groupLines(content.items) });
    }
    return pages;
  }

  let renderTask = null;

  async function renderPdfPage(pdf, pageNumber, canvas) {
    const page = await pdf.getPage(Math.min(Math.max(1, pageNumber), pdf.numPages));
    const viewport = page.getViewport({ scale: 1.35 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    if (renderTask) {
      try {
        renderTask.cancel();
      } catch (error) {
        /* önceki çizim iptal */
      }
    }
    renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport });
    try {
      await renderTask.promise;
    } catch (error) {
      if (error?.name !== "RenderingCancelledException") throw error;
    }
    return pdf.numPages;
  }

  function decodeXmlText(value) {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  }

  function paragraphsFromSlideXml(xml) {
    const paragraphs = [];
    const blocks = xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) || [];
    for (const block of blocks) {
      const parts = [];
      const tokens = block.match(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>|<a:br\b[^>]*\/?>/g) || [];
      for (const token of tokens) {
        if (/^<a:br\b/i.test(token)) {
          parts.push("\n");
          continue;
        }
        const inner = token.replace(/^<a:t(?:\s[^>]*)?>/, "").replace(/<\/a:t>$/, "");
        parts.push(decodeXmlText(inner));
      }
      const text = parts.join("").replace(/[ \t]+/g, " ").replace(/\n+/g, "\n").trim();
      if (text) paragraphs.push(text);
    }
    return paragraphs;
  }

  function resolvePptPath(slidePath, target) {
    const base = slidePath.replace(/[^/]+$/, "");
    const out = [];
    for (const part of `${base}${target}`.split("/")) {
      if (part === "..") out.pop();
      else if (part && part !== ".") out.push(part);
    }
    return out.join("/");
  }

  async function openPptx(buffer, options = {}) {
    const withImages = options.images !== false;
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/i)[1]) - Number(b.match(/(\d+)\.xml$/i)[1]));
    const slides = [];
    for (const slidePath of slideFiles) {
      const xml = await zip.files[slidePath].async("string");
      const paragraphs = paragraphsFromSlideXml(xml);
      const relPath = slidePath.replace(/slides\/(slide\d+\.xml)$/i, "slides/_rels/$1.rels");
      const images = [];
      if (withImages && zip.files[relPath]) {
        const rels = await zip.files[relPath].async("string");
        const targets = [...rels.matchAll(/Target="([^"]+)"/g)].map((match) => match[1]);
        for (const target of targets) {
          if (!/\.(png|jpe?g|gif|webp)$/i.test(target)) continue;
          const mediaPath = resolvePptPath(slidePath, target);
          const entry = zip.files[mediaPath];
          if (!entry) continue;
          const blob = await entry.async("blob");
          images.push(URL.createObjectURL(blob));
        }
      }
      slides.push({ paragraphs, images });
    }
    return { slides };
  }

  async function fromPptx(buffer) {
    const pptx = await openPptx(buffer, { images: false });
    return pptx.slides.map((slide, index) => ({
      page: index + 1,
      lines: slide.paragraphs.map((text, idx) => ({
        text,
        size: idx === 0 ? 22 : 12,
        y: 1000 - idx,
      })),
    }));
  }

  async function fromFile(fileRecord) {
    const buffer = await fileRecord.blob.arrayBuffer();
    const name = fileRecord.name.toLowerCase();
    let pages;
    if (name.endsWith(".pdf")) pages = await fromPdf(buffer);
    else if (name.endsWith(".pptx")) pages = await fromPptx(buffer);
    else throw new Error("Şimdilik PDF ve PPTX destekleniyor.");
    return pages.map((page) => ({ ...page, source: fileRecord.name }));
  }

  function renderPptxSlide(pptx, pageNumber, mount) {
    const slide = pptx.slides[Math.min(Math.max(1, pageNumber), pptx.slides.length) - 1];
    if (!slide) {
      mount.innerHTML = `<p class="status" style="color:#eee;padding:24px">Slayt okunamadı.</p>`;
      return pptx.slides.length;
    }
    const title = slide.paragraphs[0] || `Slayt ${pageNumber}`;
    const body = slide.paragraphs.slice(1);
    const images = slide.images
      .map((src) => `<img src="${src}" alt="">`)
      .join("");
    mount.innerHTML = `
      <article class="pptx-slide">
        <h2>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</h2>
        ${
          body.length
            ? `<ul>${body
                .map((line) => `<li>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</li>`)
                .join("")}</ul>`
            : ""
        }
        ${images ? `<div class="pptx-images">${images}</div>` : ""}
      </article>
    `;
    return pptx.slides.length;
  }

  return { fromFile, fromPdf, fromPptx, openPdf, openPptx, renderPdfPage, renderPptxSlide };
})();
