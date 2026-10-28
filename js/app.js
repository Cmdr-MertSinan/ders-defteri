const App = (() => {
  const root = document.getElementById("app");
  let route = parseHash();
  let state = { status: "", error: "" };

  function parseHash() {
    const raw = (location.hash.replace(/^#/, "") || "/").split("?")[0];
    const week = raw.match(/^\/course\/([^/]+)\/week\/([^/?#]+)(?:\/(ozet|summary|slides))?$/);
    if (week) {
      const tab = week[3] === "ozet" || week[3] === "summary" ? "summary" : "slides";
      return { name: "week", courseId: week[1], weekId: week[2], tab };
    }
    const course = raw.match(/^\/course\/([^/]+)/);
    if (course) return { name: "course", courseId: course[1] };
    return { name: "home" };
  }

  function go(path) {
    location.hash = path;
  }

  window.addEventListener("hashchange", () => {
    route = parseHash();
    render();
  });

  window.addEventListener("keydown", (event) => {
    if (!viewerSession?.goTo) return;
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (target && (target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (target && target.tagName === "INPUT" && target.type !== "file") return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      viewerSession.goTo(viewerSession.page - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      viewerSession.goTo(viewerSession.page + 1);
    }
  });

  function el(html) {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const COURSE_CODES = {
    Anatomi: "SBIL105",
    Fizyoloji: "SBIL103",
    Mikrobiyoloji: "SBIL109",
    Matematik: "ORTK109",
    "Halk Sagligi": "ORTK201",
    "Halk Sağlığı": "ORTK201",
    Sosyoloji: "ORTK115",
  };

  function parseSlideFileName(name) {
    const match = name.match(/^(.+?)\s+(\d+(?:-\d+)?)\.\s*hafta(?:\s+ek\s+\d+)?\.(pdf|pptx)$/i);
    if (!match) return null;
    const week = Number(String(match[2]).split("-")[0]);
    const title = name.replace(/\.(pdf|pptx)$/i, "").replace(/^.*?(?=\d)/, "").trim();
    return { courseName: match[1].trim(), week, title: title || `${week}. hafta` };
  }

  async function ensureCourse(name) {
    const display = name === "Halk Sagligi" ? "Halk Sağlığı" : name;
    const existing = (await DB.all("courses")).find((c) => c.name === display || c.name === name);
    if (existing) return existing;
    const course = {
      id: DB.uid(),
      name: display,
      code: COURSE_CODES[display] || COURSE_CODES[name] || "",
      createdAt: Date.now(),
    };
    await DB.put("courses", course);
    return course;
  }

  async function addSlideToCourse(parsed, file) {
    const course = await ensureCourse(parsed.courseName);
    const weeks = await DB.all("weeks", "byCourse", course.id);
    let week = weeks.find((item) => item.weekNumber === parsed.week);
    if (!week) {
      week = {
        id: DB.uid(),
        courseId: course.id,
        weekNumber: parsed.week,
        title: parsed.title,
        createdAt: Date.now(),
      };
      await DB.put("weeks", week);
    }
    const already = (await DB.all("files", "byWeek", week.id)).some((item) => item.name === file.name);
    if (already) return;
    await DB.put("files", {
      id: DB.uid(),
      weekId: week.id,
      name: file.name,
      type: file.type || "application/pdf",
      blob: file,
      addedAt: Date.now(),
    });
  }

  async function importMoodlePack() {
    if (location.protocol === "file:") return;
    const existingNames = new Set((await DB.all("files")).map((item) => item.name));
    try {
      const res = await fetch("moodle-slides/manifest.json?v=9");
      if (!res.ok) return;
      const pack = await res.json();
      for (const courseInfo of pack.courses) {
        for (const item of courseInfo.files) {
          if (existingNames.has(item.file)) continue;
          const fileRes = await fetch(`moodle-slides/${encodeURIComponent(item.file)}?v=9`);
          if (!fileRes.ok) continue;
          const blob = await fileRes.blob();
          const isPptx = item.file.toLowerCase().endsWith(".pptx");
          const type = isPptx
            ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            : blob.type || "application/pdf";
          const file = new File([blob], item.file, { type });
          await addSlideToCourse(
            { courseName: courseInfo.name, week: item.week, title: item.title },
            file
          );
          existingNames.add(item.file);
        }
      }
    } catch (error) {
      console.warn("Moodle paketi yüklenemedi", error);
    }
  }

  async function importSelectedSlides(fileList) {
    let count = 0;
    for (const file of fileList) {
      const parsed = parseSlideFileName(file.name);
      if (!parsed) continue;
      await addSlideToCourse(parsed, file);
      count += 1;
    }
    return count;
  }

  async function render() {
    const onSlides = route.name === "week" && route.tab !== "summary";
    if (!onSlides && viewerSession) viewerSession.goTo = null;
    await DB.open();
    const existingFiles = await DB.all("files");
    if (!existingFiles.length && location.protocol !== "file:") {
      root.innerHTML = `<div class="empty">Slaytlar yükleniyor. İlk açılışta biraz sürebilir…</div>`;
    }
    await importMoodlePack();
    if (route.name === "home") return renderHome();
    if (route.name === "course") return renderCourse();
    if (route.name === "week") return renderWeek();
  }

  async function renderHome() {
    const courses = (await DB.all("courses")).sort((a, b) => b.createdAt - a.createdAt);
    root.innerHTML = "";
    root.append(
      el(`
        <header class="topbar">
          <div class="brand">
            <small>Haftalık slayt defteri</small>
            <h1>Ders Defteri</h1>
          </div>
        </header>
      `)
    );
    if (state.error) root.append(el(`<p class="error">${escapeHtml(state.error)}</p>`));
    if (!courses.length) {
      root.append(el(`<div class="empty">Henüz ders yok. Moodle slaytları yüklenince burada görünecek.</div>`));
      return;
    }
    const grid = el(`<div class="grid"></div>`);
    for (const course of courses) {
      const weeks = await DB.all("weeks", "byCourse", course.id);
      const card = el(`
        <button class="card clickable" type="button">
          <h2>${escapeHtml(course.name)}</h2>
          <div class="meta">${escapeHtml(course.code || "Ders kodu yok")} · ${weeks.length} hafta</div>
        </button>
      `);
      card.addEventListener("click", () => go(`/course/${course.id}`));
      grid.append(card);
    }
    root.append(grid);
  }

  async function courseNotesCard(course) {
    const note = (await DB.get("notes", course.id)) || { courseId: course.id, text: "" };
    const card = el(`
      <div class="card form-card notes-card">
        <strong>Not defteri</strong>
        <p class="meta">${escapeHtml(course.name)} için kendi notların. Otomatik kaydedilir.</p>
        <textarea id="course-notes" rows="8" placeholder="Ders notu, hatırlatma, özet kenarına yazdıkların…"></textarea>
      </div>
    `);
    const area = card.querySelector("#course-notes");
    area.value = note.text || "";
    let timer = null;
    area.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        DB.put("notes", {
          courseId: course.id,
          text: area.value,
          updatedAt: Date.now(),
        });
      }, 250);
    });
    return card;
  }

  async function renderCourse() {
    const course = await DB.get("courses", route.courseId);
    if (!course) return go("/");
    const weeks = (await DB.all("weeks", "byCourse", course.id)).sort(
      (a, b) => a.weekNumber - b.weekNumber
    );
    root.innerHTML = "";
    root.append(
      el(`
        <header class="topbar">
          <div class="brand">
            <div class="crumbs"><a href="#/">Dersler</a> / ${escapeHtml(course.name)}</div>
            <h1>${escapeHtml(course.name)}</h1>
            <div class="meta">${escapeHtml(course.code || "")}</div>
          </div>
        </header>
      `)
    );
    root.append(await courseNotesCard(course));
    if (!weeks.length) {
      root.append(el(`<div class="empty">Bu derste henüz hafta yok.</div>`));
      return;
    }
    const grid = el(`<div class="grid"></div>`);
    for (const week of weeks) {
      const files = await DB.all("files", "byWeek", week.id);
      const card = el(`
        <button class="card clickable" type="button">
          <h2>Hafta ${week.weekNumber}</h2>
          <div class="meta">${escapeHtml(week.title || "Konu başlığı yok")} · ${files.length} slayt dosyası</div>
        </button>
      `);
      card.addEventListener("click", () => go(`/course/${course.id}/week/${week.id}`));
      grid.append(card);
    }
    root.append(grid);
  }

  async function renderWeek() {
    const course = await DB.get("courses", route.courseId);
    const week = await DB.get("weeks", route.weekId);
    if (!course || !week) return go("/");
    const files = (await DB.all("files", "byWeek", week.id)).sort((a, b) => a.addedAt - b.addedAt);
    const summary = await DB.get("summaries", week.id);
    const tab = route.tab === "summary" ? "summary" : "slides";

    root.innerHTML = "";
    root.append(
      el(`
        <header class="topbar">
          <div class="brand">
            <div class="crumbs">
              <a href="#/">Dersler</a> /
              <a href="#/course/${course.id}">${escapeHtml(course.name)}</a> /
              Hafta ${week.weekNumber}
            </div>
            <h1>Hafta ${week.weekNumber}</h1>
            <div class="meta">${escapeHtml(week.title || "Slaytlar ve özet")}</div>
          </div>
        </header>
      `)
    );
    const tabs = el(`
      <nav class="tabs">
        <button class="tab ${tab === "slides" ? "active" : ""}" type="button" data-tab="slides">Slaytlar</button>
        <button class="tab ${tab === "summary" ? "active" : ""}" type="button" data-tab="summary">Özet</button>
      </nav>
    `);
    tabs.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => {
        const suffix = button.dataset.tab === "summary" ? "/ozet" : "";
        go(`/course/${course.id}/week/${week.id}${suffix}`);
      });
    });
    root.append(tabs);
    if (state.error) root.append(el(`<p class="error">${escapeHtml(state.error)}</p>`));
    if (tab === "slides") renderSlidesTab(files, week);
    else await renderSummaryTab(course, week, files, summary);
  }

  function renderSlidesTab(files, week) {
    const drop = el(`
      <div class="drop">
        Haftalık ders slaytını buraya bırak veya seç (PDF / PPTX). Orijinal dosya bu derste saklanır.
        <div style="margin-top:12px">
          <input id="file-input" type="file" accept=".pdf,.pptx,application/pdf" multiple />
        </div>
      </div>
    `);
    const input = drop.querySelector("#file-input");
    async function ingest(fileList) {
      state.error = "";
      for (const file of [...fileList]) {
        await DB.put("files", {
          id: DB.uid(),
          weekId: week.id,
          name: file.name,
          type: file.type || "application/octet-stream",
          blob: file,
          addedAt: Date.now(),
        });
      }
      render();
    }
    input.addEventListener("change", (event) => ingest(event.target.files));
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      drop.classList.remove("over");
      ingest(event.dataTransfer.files);
    });
    root.append(drop);

    if (!files.length) {
      root.append(el(`<div class="empty">Bu haftaya henüz slayt yüklenmedi.</div>`));
      return;
    }

    const list = el(`<div class="file-list"></div>`);
    files.forEach((file, index) => {
      const row = el(`
        <div class="file-row">
          <div>
            <strong>${escapeHtml(file.name)}</strong>
            <div class="meta">${Math.round((file.blob.size || 0) / 1024)} KB</div>
          </div>
          <div class="row">
            <button class="btn secondary" data-view="${index}" type="button">Göster</button>
            <a class="btn secondary" download="${escapeHtml(file.name)}">İndir</a>
            <button class="btn ghost" data-del="${file.id}" type="button">Sil</button>
          </div>
        </div>
      `);
      const url = URL.createObjectURL(file.blob);
      row.querySelector("a").href = url;
      row.querySelector("[data-view]").addEventListener("click", () => showFile(file));
      row.querySelector("[data-del]").addEventListener("click", async () => {
        await DB.del("files", file.id);
        render();
      });
      list.append(row);
    });
    root.append(list);
    const viewer = el(`
      <div>
        <div class="row" id="page-nav" hidden>
          <button class="btn secondary" id="prev-page" type="button">Önceki sayfa</button>
          <span class="status" id="page-label"></span>
          <button class="btn secondary" id="next-page" type="button">Sonraki sayfa</button>
        </div>
        <div class="viewer" id="viewer"><canvas></canvas></div>
      </div>
    `);
    root.append(viewer);
    showFile(files[0]);
  }

  let viewerSession = null;

  async function showFile(file) {
    const viewer = document.getElementById("viewer");
    const nav = document.getElementById("page-nav");
    const prev = document.getElementById("prev-page");
    const next = document.getElementById("next-page");
    const label = document.getElementById("page-label");
    if (!viewer) return;
    const canvas = document.createElement("canvas");
    viewer.innerHTML = "";
    viewer.append(canvas);
    if (viewerSession?.pdf) {
      try {
        await viewerSession.pdf.destroy();
      } catch (error) {
        /* önceki belge kapanır */
      }
    }
    if (viewerSession?.pptx) {
      for (const slide of viewerSession.pptx.slides) {
        for (const src of slide.images || []) URL.revokeObjectURL(src);
      }
    }
    viewerSession = { fileId: file.id, page: 1, total: 1, pdf: null, drawing: false };
    try {
      if (file.name.toLowerCase().endsWith(".pdf")) {
        const pdf = await Extract.openPdf(await file.blob.arrayBuffer());
        viewerSession.pdf = pdf;
        viewerSession.total = pdf.numPages;
        let pending = null;
        const goTo = async (page) => {
          pending = Math.min(Math.max(1, page), viewerSession.total);
          if (viewerSession.drawing) return;
          viewerSession.drawing = true;
          try {
            while (pending !== null && viewerSession.fileId === file.id) {
              viewerSession.page = pending;
              pending = null;
              await Extract.renderPdfPage(pdf, viewerSession.page, canvas);
              if (label) label.textContent = `Sayfa ${viewerSession.page} / ${viewerSession.total}`;
              if (prev) prev.disabled = viewerSession.page <= 1;
              if (next) next.disabled = viewerSession.page >= viewerSession.total;
            }
          } finally {
            viewerSession.drawing = false;
          }
        };
        if (nav) nav.hidden = viewerSession.total <= 1;
        viewerSession.goTo = goTo;
        prev.onclick = () => goTo(viewerSession.page - 1);
        next.onclick = () => goTo(viewerSession.page + 1);
        await goTo(1);
      } else if (file.name.toLowerCase().endsWith(".pptx")) {
        const pptx = await Extract.openPptx(await file.blob.arrayBuffer());
        viewerSession.pptx = pptx;
        viewerSession.total = pptx.slides.length || 1;
        let pending = null;
        const goTo = async (page) => {
          pending = Math.min(Math.max(1, page), viewerSession.total);
          if (viewerSession.drawing) return;
          viewerSession.drawing = true;
          try {
            while (pending !== null && viewerSession.fileId === file.id) {
              viewerSession.page = pending;
              pending = null;
              Extract.renderPptxSlide(pptx, viewerSession.page, viewer);
              if (label) label.textContent = `Slayt ${viewerSession.page} / ${viewerSession.total}`;
              if (prev) prev.disabled = viewerSession.page <= 1;
              if (next) next.disabled = viewerSession.page >= viewerSession.total;
            }
          } finally {
            viewerSession.drawing = false;
          }
        };
        if (nav) nav.hidden = viewerSession.total <= 1;
        viewerSession.goTo = goTo;
        prev.onclick = () => goTo(viewerSession.page - 1);
        next.onclick = () => goTo(viewerSession.page + 1);
        await goTo(1);
      } else {
        if (nav) nav.hidden = true;
        viewer.innerHTML = `<p class="status" style="color:#eee;padding:24px">Bu dosya türü önizlenemiyor. İndirip açabilirsin.</p>`;
      }
    } catch (error) {
      viewer.innerHTML = `<p class="status" style="color:#eee;padding:24px">${escapeHtml(error.message)}</p>`;
    }
  }

  function fileFingerprint(files) {
    return files.map((file) => `${file.id}:${file.blob.size}:${file.name}`).join("|");
  }

  async function renderSummaryTab(course, week, files, summary) {
    if (!files.length) {
      root.append(el(`<div class="empty">Özet için önce Slaytlar sekmesinden bu haftanın PDF’ini yükle.</div>`));
      return;
    }

    const fingerprint = fileFingerprint(files);
    const ready = summary && summary.fingerprint === fingerprint;
    const busy = state.summarizing === week.id;

    const bar = el(`
      <div class="toolbar">
        <div class="status">${
          busy
            ? "Slaytlar özetleniyor…"
            : ready
              ? `${summary.sections.length} slayt özeti · ${new Date(summary.generatedAt).toLocaleString("tr-TR")}`
              : `${files.length} slayt dosyası hazır. Özeti çıkar’a bas.`
        }</div>
        <div class="row">
          <button class="btn" id="extract-summary" type="button" ${busy ? "disabled" : ""}>
            ${ready ? "Özeti çıkar" : "Özeti çıkar"}
          </button>
          <button class="btn secondary" id="pdf" type="button" ${ready && !busy ? "" : "disabled"}>PDF indir</button>
        </div>
      </div>
    `);
    bar.querySelector("#extract-summary").addEventListener("click", () => {
      generateSummary(week, files, fingerprint);
    });
    bar.querySelector("#pdf").addEventListener("click", () => exportPdf(course, week, summary));
    root.append(bar);
    root.append(await courseNotesCard(course));

    if (busy) {
      root.append(el(`<div class="empty">Yüklediğin slaytlar sayfa sayfa özetleniyor…</div>`));
      return;
    }

    if (!ready) {
      root.append(
        el(`<div class="empty">Bu haftanın slaytlarını özetlemek için <strong>Özeti çıkar</strong> butonuna bas. Her slayt kendi başlığı ve maddeleriyle listelenir.</div>`)
      );
      return;
    }

    const sheet = el(`<div id="summary-sheet"></div>`);
    sheet.append(
      el(`<h2 style="font-family:Fraunces,serif;margin-top:0">${escapeHtml(course.name)} · Hafta ${week.weekNumber}</h2>`)
    );
    if (week.title) sheet.append(el(`<p class="meta">${escapeHtml(week.title)}</p>`));
    for (const section of summary.sections) {
      const source = [section.source, section.page ? `Slayt ${section.page}` : ""]
        .filter(Boolean)
        .join(" · ");
      const block = el(`
        <section class="section">
          <h3>${escapeHtml(section.heading)}</h3>
          ${source ? `<p class="meta">${escapeHtml(source)}</p>` : ""}
          ${
            section.points.length
              ? `<ul>${section.points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>`
              : `<p class="meta">Bu slaytta maddelenecek metin yok.</p>`
          }
        </section>
      `);
      sheet.append(block);
    }
    root.append(sheet);
  }

  async function generateSummary(week, files, fingerprint) {
    if (state.summarizing === week.id) return;
    state.error = "";
    state.summarizing = week.id;
    await render();
    try {
      const pages = [];
      for (const file of files) {
        const extracted = await Extract.fromFile(file);
        pages.push(...extracted);
      }
      const sections = Summarize.build(pages);
      await DB.put("summaries", {
        weekId: week.id,
        generatedAt: Date.now(),
        fingerprint: fingerprint || fileFingerprint(files),
        sections,
      });
      state.summaryFailed = null;
    } catch (error) {
      state.error = error.message || "Özet çıkarılamadı. Slayt taranmış görüntüyse metin okunamayabilir.";
      state.summaryFailed = week.id;
    } finally {
      state.summarizing = null;
    }
    await render();
  }

  async function exportPdf(course, week, summary) {
    if (!summary || !window.html2pdf) return;
    const node = document.getElementById("summary-sheet");
    if (!node) return;
    const filename = `${course.code || course.name}-hafta-${week.weekNumber}-ozet.pdf`.replace(/\s+/g, "-");
    await html2pdf()
      .set({
        margin: 12,
        filename,
        image: { type: "jpeg", quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .from(node)
      .save();
  }

  return { start: render };
})();

App.start();
