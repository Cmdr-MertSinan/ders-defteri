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
      const res = await fetch("moodle-slides/manifest.json?v=20");
      if (!res.ok) return;
      const pack = await res.json();
      for (const courseInfo of pack.courses) {
        for (const item of courseInfo.files) {
          if (existingNames.has(item.file)) continue;
          const fileRes = await fetch(`moodle-slides/${encodeURIComponent(item.file)}?v=20`);
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
    if (!cloudReady) {
      cloudReady = true;
      try {
        await pullCloudNotes();
      } catch (error) {
        console.warn("cloud pull", error);
      }
    }
    try {
      await importLivePack();
    } catch (error) {
      console.warn("live pack", error);
    }
    if (route.name === "home") await renderHome();
    else if (route.name === "course") await renderCourse();
    else if (route.name === "week") await renderWeek();
    if (!state.packStarted && location.protocol !== "file:") {
      state.packStarted = true;
      importMoodlePack()
        .then(async () => {
          if (route.name === "home") await renderHome();
        })
        .catch((error) => console.warn("Moodle paketi", error));
    }
  }

  const MONTHS_TR = [
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
  ];
  const WEEKDAYS_TR = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const today = new Date();
  let calView = { year: today.getFullYear(), month: today.getMonth() };
  let calSelected = dateKey(today);

  function dateKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDayLabel(key) {
    const d = parseDateKey(key);
    return `${d.getDate()} ${MONTHS_TR[d.getMonth()]} ${d.getFullYear()}`;
  }

  const GH_REPO = "Cmdr-MertSinan/ders-defteri";
  const CLOUD_NOTES_PATH = "data/user-state.json";
  const NOTES_SYNC_TOPIC = "neoclass-2ea2b0e3de749c573fd60ad016c8061f";
  let cloudSha = "";
  let cloudTimer = 0;
  let cloudReady = false;

  function getSyncToken() {
    try {
      return localStorage.getItem("mertAjanda.syncToken") || "";
    } catch (error) {
      return "";
    }
  }

  function setSyncToken(token) {
    localStorage.setItem("mertAjanda.syncToken", String(token || "").trim());
  }

  function textToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function base64ToText(value) {
    const binary = atob(String(value || "").replace(/\n/g, ""));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function buildCloudNotes() {
    const dayNotes = {};
    for (const item of await DB.all("dayNotes")) {
      dayNotes[item.date] = { text: item.text || "", updatedAt: item.updatedAt || 0 };
    }
    const courseNotes = {};
    const courses = await DB.all("courses");
    for (const item of await DB.all("notes")) {
      const course = courses.find((entry) => entry.id === item.courseId);
      const name = item.courseName || course?.name;
      if (!name) continue;
      courseNotes[name] = { text: item.text || "", updatedAt: item.updatedAt || 0 };
    }
    return { updatedAt: Date.now(), dayNotes, courseNotes };
  }

  async function applyCloudNotes(cloud) {
    if (!cloud) return;
    for (const [date, row] of Object.entries(cloud.dayNotes || {})) {
      const local = await DB.get("dayNotes", date);
      if (local && (local.updatedAt || 0) > (row.updatedAt || 0)) continue;
      await DB.put("dayNotes", {
        date,
        text: row.text || "",
        updatedAt: row.updatedAt || 0,
      });
    }
    const courses = await DB.all("courses");
    for (const [name, row] of Object.entries(cloud.courseNotes || {})) {
      const course = courses.find((entry) => entry.name === name);
      if (!course) continue;
      const local = await DB.get("notes", course.id);
      if (local && (local.updatedAt || 0) > (row.updatedAt || 0)) continue;
      await DB.put("notes", {
        courseId: course.id,
        courseName: name,
        text: row.text || "",
        updatedAt: row.updatedAt || 0,
      });
    }
  }

  async function pullCloudNotes() {
    if (location.protocol === "file:") return;
    try {
      const api = await fetch(
        `https://api.github.com/repos/${GH_REPO}/contents/${CLOUD_NOTES_PATH}?ref=main&ts=${Date.now()}`,
        { headers: { Accept: "application/vnd.github.raw" }, cache: "no-store" }
      );
      if (api.ok) {
        await applyCloudNotes(await api.json());
        return;
      }
    } catch (error) {
      console.warn("cloud api pull", error);
    }
    const res = await fetch(`${CLOUD_NOTES_PATH}?ts=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    await applyCloudNotes(await res.json());
  }

  async function publishNotesRelay(payload) {
    const res = await fetch(`https://ntfy.sh/${NOTES_SYNC_TOPIC}`, {
      method: "POST",
      body: payload,
      headers: { Title: "neoclass-notes" },
    });
    if (!res.ok) throw new Error("Notlar gönderilemedi");
  }

  async function pushCloudNotes(retried = false) {
    const payload = JSON.stringify(await buildCloudNotes(), null, 2);
    await publishNotesRelay(payload);
    const token = getSyncToken();
    if (!token) return true;
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (!cloudSha) {
      const current = await fetch(
        `https://api.github.com/repos/${GH_REPO}/contents/${CLOUD_NOTES_PATH}`,
        { headers, cache: "no-store" }
      );
      if (current.ok) {
        const body = await current.json();
        cloudSha = body.sha || "";
      }
    }
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${CLOUD_NOTES_PATH}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        message: "Sync ajanda notes",
        content: textToBase64(payload),
        sha: cloudSha || undefined,
        branch: "main",
      }),
    });
    if ((res.status === 409 || res.status === 422) && !retried) {
      cloudSha = "";
      return pushCloudNotes(true);
    }
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(detail.slice(0, 180) || `GitHub ${res.status}`);
    }
    const saved = await res.json();
    cloudSha = saved.content?.sha || cloudSha;
    return true;
  }

  function queueCloudPush() {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => {
      pushCloudNotes().catch((error) => {
        console.warn("cloud push", error);
      });
    }, 900);
  }

  async function flushOpenNotes() {
    const gym = document.querySelector("#gym-note");
    if (gym) {
      await DB.put("dayNotes", {
        date: calSelected,
        text: gym.value,
        updatedAt: Date.now(),
      });
    }
    const courseArea = document.querySelector("#course-notes");
    if (courseArea && route.courseId) {
      const course = await DB.get("courses", route.courseId);
      if (course) {
        await DB.put("notes", {
          courseId: course.id,
          courseName: course.name,
          text: courseArea.value,
          updatedAt: Date.now(),
        });
      }
    }
  }

  function topBar(brandHtml) {
    const header = el(`
      <header class="topbar">
        <div class="brand">${brandHtml}</div>
        <button class="btn save-btn" id="save-sync" type="button">Kaydet</button>
      </header>
    `);
    header.querySelector("#save-sync").addEventListener("click", saveAndSync);
    return header;
  }

  async function saveAndSync() {
    const btn = document.querySelector("#save-sync");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Kaydediliyor…";
    }
    try {
      await flushOpenNotes();
      try {
        await pushCloudNotes();
      } catch (error) {
        console.warn("cloud push", error);
      }
      await pullCloudNotes();
      await importLivePack();
      state.sync = "Kaydedildi. Bilgisayarda birkaç dakika içinde görünür.";
      state.error = "";
      await render();
    } catch (error) {
      state.error = error.message || "Kaydedilemedi.";
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Kaydet";
      }
    }
  }

  async function gymCalendarCard() {
    const notes = await DB.all("dayNotes");
    const noted = new Set(notes.filter((item) => (item.text || "").trim()).map((item) => item.date));
    const todayKey = dateKey(new Date());
    const first = new Date(calView.year, calView.month, 1);
    const startPad = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(calView.year, calView.month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(dateKey(new Date(calView.year, calView.month, day)));
    }
    const card = el(`
      <section class="card form-card gym-calendar">
        <div class="cal-toolbar">
          <div>
            <strong>Spor takvimi</strong>
            <p class="meta">Güne tıkla, o gün sporda yaptıklarını yaz. Bilgisayarda yazınca telefonda da görünür.</p>
          </div>
          <div class="row cal-nav">
            <button class="btn secondary" id="cal-prev" type="button" aria-label="Önceki ay">‹</button>
            <span class="cal-month">${MONTHS_TR[calView.month]} ${calView.year}</span>
            <button class="btn secondary" id="cal-next" type="button" aria-label="Sonraki ay">›</button>
          </div>
        </div>
        <div class="cal-grid" id="cal-grid">
          ${WEEKDAYS_TR.map((name) => `<span class="cal-weekday">${name}</span>`).join("")}
          ${cells
            .map((key) => {
              if (!key) return `<span class="cal-empty"></span>`;
              const day = Number(key.slice(-2));
              const classes = [
                "cal-day",
                key === todayKey ? "today" : "",
                key === calSelected ? "selected" : "",
                noted.has(key) ? "has-note" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `<button class="${classes}" type="button" data-day="${key}">${day}</button>`;
            })
            .join("")}
        </div>
        <label>
          ${formatDayLabel(calSelected)}
          <textarea id="gym-note" rows="5" placeholder="O gün sporda ne yaptın? Set, kilo, koşu…"></textarea>
        </label>
      </section>
    `);
    const area = card.querySelector("#gym-note");
    const current = notes.find((item) => item.date === calSelected);
    area.value = current?.text || "";
    let timer = null;
    async function saveNote() {
      clearTimeout(timer);
      await DB.put("dayNotes", {
        date: calSelected,
        text: area.value,
        updatedAt: Date.now(),
      });
      queueCloudPush();
    }
    async function replaceCalendar() {
      const next = await gymCalendarCard();
      card.replaceWith(next);
    }
    area.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(saveNote, 250);
    });
    card.querySelector("#cal-prev").addEventListener("click", async () => {
      await saveNote();
      calView.month -= 1;
      if (calView.month < 0) {
        calView.month = 11;
        calView.year -= 1;
      }
      replaceCalendar();
    });
    card.querySelector("#cal-next").addEventListener("click", async () => {
      await saveNote();
      calView.month += 1;
      if (calView.month > 11) {
        calView.month = 0;
        calView.year += 1;
      }
      replaceCalendar();
    });
    card.querySelectorAll("[data-day]").forEach((button) => {
      button.addEventListener("click", async () => {
        await saveNote();
        calSelected = button.dataset.day;
        replaceCalendar();
      });
    });
    return card;
  }

  const BYDAY_TO_JS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const LIVE_DAY = {
    paz: 0,
    sun: 0,
    pzt: 1,
    pazartesi: 1,
    mon: 1,
    sal: 2,
    sali: 2,
    salı: 2,
    tue: 2,
    car: 3,
    çar: 3,
    cars: 3,
    wed: 3,
    per: 4,
    persembe: 4,
    perşembe: 4,
    thu: 4,
    cum: 5,
    cuma: 5,
    fri: 5,
    cmt: 6,
    sat: 6,
  };

  function liveDays(days) {
    return (days || [])
      .map((raw) => {
        if (typeof raw === "number") return raw;
        return LIVE_DAY[String(raw).trim().toLowerCase()];
      })
      .filter((day) => day !== undefined);
  }

  async function importLivePack() {
    if (location.protocol === "file:") return;
    try {
      const res = await fetch("data/live-classes.json?v=20");
      if (!res.ok) return;
      const pack = await res.json();
      const existing = await DB.all("liveClasses");
      for (const item of pack.classes || []) {
        const days = liveDays(item.days);
        const joinUrl = normalizeTeamsMeetingUrl(item.joinUrl) || item.joinUrl;
        if (!item.title || !joinUrl || !days.length) continue;
        const found = existing.find((entry) => entry.title === item.title && entry.start === item.start);
        if (found) {
          await DB.put("liveClasses", {
            ...found,
            days,
            joinUrl,
            autoJoin: item.autoJoin !== false,
          });
        } else {
          await DB.put("liveClasses", {
            id: DB.uid(),
            title: item.title,
            days,
            start: item.start,
            joinUrl,
            autoJoin: item.autoJoin !== false,
            lastJoined: "",
            createdAt: Date.now(),
          });
        }
      }
    } catch (error) {
      console.warn("Canlı ders paketi yüklenemedi", error);
    }
  }
  let liveJoinBusy = new Set();

  function weekdayLabel(jsDay) {
    return WEEKDAYS_TR[(jsDay + 6) % 7];
  }

  function parseHm(value) {
    const parts = String(value || "").split(":");
    return Number(parts[0]) * 60 + Number(parts[1] || 0);
  }

  function extractTeamsUrl(text) {
    const match = String(text || "").match(
      /(?:https?:\/\/|msteams:\/\/)[^\s<>"']*(teams\.microsoft\.com|teams\.live\.com)[^\s<>"']*/i
    );
    return match ? match[0].replace(/[.,);]+$/g, "") : "";
  }

  function normalizeTeamsMeetingUrl(text) {
    const raw = extractTeamsUrl(text) || String(text || "").trim();
    if (!raw) return "";
    const href = raw.replace(/^msteams:/i, "https:");
    let parsed;
    try {
      parsed = new URL(href);
    } catch (error) {
      return raw;
    }
    const teamMatch = parsed.pathname.match(/\/l\/(?:team|channel)\/([^/]+)/i);
    if (!teamMatch) return parsed.href;
    const thread = teamMatch[1];
    const tenant = parsed.searchParams.get("tenantId") || "";
    const context = tenant ? encodeURIComponent(JSON.stringify({ Tid: tenant })) : "";
    return `https://teams.microsoft.com/l/meetup-join/${thread}/0${context ? `?context=${context}` : ""}`;
  }

  function teamsJoinUrl(text) {
    const found = extractTeamsUrl(text);
    return found ? normalizeTeamsMeetingUrl(found) : "";
  }

  function isLiveNow(item, clock = new Date()) {
    if (!item.days?.includes(clock.getDay())) return false;
    const start = parseHm(item.start);
    const now = clock.getHours() * 60 + clock.getMinutes();
    return now >= start - 2 && now <= start + 45;
  }

  function joinKey(item, clock = new Date()) {
    return `${item.id}:${dateKey(clock)}:${item.start}`;
  }

  function teamsAppUrl(url) {
    const raw = normalizeTeamsMeetingUrl(url);
    if (!raw) return "";
    if (/^msteams:/i.test(raw)) return raw;
    try {
      const parsed = new URL(raw);
      parsed.searchParams.delete("anon");
      parsed.searchParams.delete("anonymous");
      return `msteams://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch (error) {
      return raw.replace(/^https?:\/\//i, "msteams://");
    }
  }

  function openTeamsMeeting(url) {
    const appUrl = teamsAppUrl(url);
    if (!appUrl) return;
    const link = document.createElement("a");
    link.href = appUrl;
    document.body.append(link);
    link.click();
    link.remove();
  }

  async function requestLiveNotify() {
    if (!("Notification" in window) || Notification.permission !== "default") return;
    try {
      await Notification.requestPermission();
    } catch (error) {
      /* tarayıcı izin vermeyebilir */
    }
  }

  async function joinLiveClass(item, { notify = false } = {}) {
    const key = joinKey(item);
    if (liveJoinBusy.has(key)) return;
    liveJoinBusy.add(key);
    const joinUrl = normalizeTeamsMeetingUrl(item.joinUrl) || item.joinUrl;
    const saved = { ...item, joinUrl, lastJoined: key, updatedAt: Date.now() };
    await DB.put("liveClasses", saved);
    if (notify && "Notification" in window && Notification.permission === "granted") {
      const note = new Notification(item.title, { body: "Canlı ders başlıyor. Katılmak için dokun.", tag: key });
      note.onclick = () => openTeamsMeeting(joinUrl);
    }
    openTeamsMeeting(joinUrl);
  }

  async function migrateLiveClassUrls() {
    const items = await DB.all("liveClasses");
    for (const item of items) {
      const joinUrl = normalizeTeamsMeetingUrl(item.joinUrl);
      if (!joinUrl || joinUrl === item.joinUrl) continue;
      await DB.put("liveClasses", { ...item, joinUrl, updatedAt: Date.now() });
    }
  }

  async function tickLiveClasses() {
    const items = await DB.all("liveClasses");
    const clock = new Date();
    for (const item of items) {
      if (!item.autoJoin || !item.joinUrl) continue;
      if (!isLiveNow(item, clock)) continue;
      if (item.lastJoined === joinKey(item, clock)) continue;
      await joinLiveClass(item, { notify: true });
    }
  }

  function startLiveWatcher() {
    migrateLiveClassUrls().then(() => tickLiveClasses());
    setInterval(tickLiveClasses, 20000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tickLiveClasses();
    });
  }

  function unfoldIcs(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n[ \t]/g, "");
  }

  function parseIcsEvents(text) {
    const blocks = unfoldIcs(text).split(/BEGIN:VEVENT/i).slice(1);
    const events = [];
    for (const block of blocks) {
      const summary = (block.match(/^SUMMARY(?:;[^:]*)?:(.+)$/im) || [])[1]?.trim() || "Canlı ders";
      const dt = (block.match(/^DTSTART(?:;[^:]*)?:(\d{8}T\d{6})/im) || [])[1];
      const rrule = (block.match(/^RRULE:(.+)$/im) || [])[1] || "";
      const url =
        teamsJoinUrl((block.match(/^URL(?:;[^:]*)?:(.+)$/im) || [])[1] || "") ||
        teamsJoinUrl(block);
      if (!dt || !url) continue;
      const start = `${dt.slice(9, 11)}:${dt.slice(11, 13)}`;
      let days = [];
      const byday = rrule.match(/BYDAY=([A-Z,]+)/i);
      if (byday) {
        days = byday[1]
          .split(",")
          .map((code) => BYDAY_TO_JS[code.trim().slice(-2)])
          .filter((day) => day !== undefined);
      }
      if (!days.length) {
        const y = Number(dt.slice(0, 4));
        const mo = Number(dt.slice(4, 6)) - 1;
        const d = Number(dt.slice(6, 8));
        days = [new Date(y, mo, d).getDay()];
      }
      events.push({ title: summary.replace(/\\,/g, ","), start, days, joinUrl: url });
    }
    return events;
  }

  async function liveClassesCard() {
    const items = (await DB.all("liveClasses")).sort(
      (a, b) => parseHm(a.start) - parseHm(b.start) || a.title.localeCompare(b.title, "tr")
    );
    const clock = new Date();
    const todayItems = items.filter((item) => item.days?.includes(clock.getDay()));
    const card = el(`
      <section class="card form-card live-card">
        <div>
          <strong>Canlı dersler</strong>
          <p class="meta">Katılınca tarayıcıda misafir açılmaz; telefonda/bilgisayarda senin Teams uygulaman açılır. Yoklama için Teams’te 26121188@eul.edu.tr hesabın açık kalsın.</p>
        </div>
        <div class="live-today" id="live-today"></div>
        <details class="live-add">
          <summary>Teams dersi ekle</summary>
          <label>Ders adı<input id="live-title" type="text" placeholder="Anatomi" /></label>
          <div class="day-picks" id="live-days">
            ${[1, 2, 3, 4, 5, 6, 0]
              .map(
                (day) =>
                  `<label class="day-pick"><input type="checkbox" value="${day}" />${weekdayLabel(day)}</label>`
              )
              .join("")}
          </div>
          <label>Saat<input id="live-start" type="time" value="09:00" /></label>
          <label>Teams katılma linki<input id="live-url" type="text" placeholder="https://teams.microsoft.com/l/meetup-join/…" /></label>
          <label class="inline-check"><input id="live-auto" type="checkbox" checked /> Saat gelince otomatik katıl</label>
          <div class="row">
            <button class="btn" id="live-save" type="button">Kaydet</button>
            <label class="btn secondary live-ics">Takvim dosyası (.ics)<input id="live-ics" type="file" accept=".ics,text/calendar" hidden /></label>
          </div>
        </details>
        <div class="live-all" id="live-all"></div>
      </section>
    `);
    const todayBox = card.querySelector("#live-today");
    if (!todayItems.length) {
      todayBox.append(el(`<p class="status">Bugün kayıtlı canlı ders yok.</p>`));
    } else {
      for (const item of todayItems) {
        const live = isLiveNow(item, clock);
        const row = el(`
          <div class="live-row ${live ? "now" : ""}">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <div class="meta">${item.start} · ${item.autoJoin ? "otomatik katıl açık" : "manuel"}</div>
            </div>
            <a class="btn ${live ? "" : "secondary"}" href="${escapeHtml(teamsAppUrl(item.joinUrl))}">Katıl</a>
          </div>
        `);
        todayBox.append(row);
      }
    }
    const allBox = card.querySelector("#live-all");
    for (const item of items) {
      const row = el(`
        <div class="file-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="meta">${(item.days || []).map(weekdayLabel).join(", ")} · ${item.start}</div>
          </div>
          <div class="row">
            <button class="btn ghost" data-toggle="${item.id}" type="button">${item.autoJoin ? "Oto açık" : "Oto kapalı"}</button>
            <button class="btn ghost" data-del="${item.id}" type="button">Sil</button>
          </div>
        </div>
      `);
      allBox.append(row);
    }
    async function redraw() {
      const next = await liveClassesCard();
      card.replaceWith(next);
    }
    card.querySelector("#live-save").addEventListener("click", async () => {
      const title = card.querySelector("#live-title").value.trim();
      const joinUrl = teamsJoinUrl(card.querySelector("#live-url").value) || card.querySelector("#live-url").value.trim();
      const days = [...card.querySelectorAll("#live-days input:checked")].map((input) => Number(input.value));
      const start = card.querySelector("#live-start").value;
      if (!title || !joinUrl || !days.length || !start) {
        state.error = "Ders adı, gün, saat ve Teams linki gerekli.";
        render();
        return;
      }
      if (card.querySelector("#live-auto").checked) await requestLiveNotify();
      await DB.put("liveClasses", {
        id: DB.uid(),
        title,
        days,
        start,
        joinUrl,
        autoJoin: card.querySelector("#live-auto").checked,
        lastJoined: "",
        createdAt: Date.now(),
      });
      state.error = "";
      redraw();
    });
    card.querySelector("#live-ics").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const events = parseIcsEvents(await file.text());
      if (!events.length) {
        state.error = "Dosyada Teams katılma linki bulunan ders bulunamadı.";
        render();
        return;
      }
      await requestLiveNotify();
      for (const eventItem of events) {
        await DB.put("liveClasses", {
          id: DB.uid(),
          title: eventItem.title,
          days: eventItem.days,
          start: eventItem.start,
          joinUrl: eventItem.joinUrl,
          autoJoin: true,
          lastJoined: "",
          createdAt: Date.now(),
        });
      }
      state.error = "";
      redraw();
    });
    allBox.querySelectorAll("[data-toggle]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = items.find((entry) => entry.id === button.dataset.toggle);
        if (!item) return;
        if (!item.autoJoin) await requestLiveNotify();
        await DB.put("liveClasses", { ...item, autoJoin: !item.autoJoin });
        redraw();
      });
    });
    allBox.querySelectorAll("[data-del]").forEach((button) => {
      button.addEventListener("click", async () => {
        await DB.del("liveClasses", button.dataset.del);
        redraw();
      });
    });
    return card;
  }

  async function renderHome() {
    const courses = (await DB.all("courses")).sort((a, b) => b.createdAt - a.createdAt);
    root.innerHTML = "";
    root.append(topBar(`<h1>Neo Class for Mert</h1>`));
    if (state.error) root.append(el(`<p class="error">${escapeHtml(state.error)}</p>`));
    if (state.sync) root.append(el(`<p class="meta">${escapeHtml(state.sync)}</p>`));
    root.append(el(`<h2 class="term-heading">1. sınıf güz</h2>`));
    if (!courses.length) {
      root.append(el(`<div class="empty">Henüz ders yok. Moodle slaytları yüklenince burada görünecek.</div>`));
    } else {
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
    root.append(await liveClassesCard());
    root.append(await gymCalendarCard());
  }

  async function courseNotesCard(course) {
    const note = (await DB.get("notes", course.id)) || { courseId: course.id, text: "" };
    const card = el(`
      <div class="card form-card notes-card">
        <strong>Not defteri</strong>
        <p class="meta">${escapeHtml(course.name)} için kendi notların. Bilgisayarda yazınca telefonda da görünür.</p>
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
          courseName: course.name,
          text: area.value,
          updatedAt: Date.now(),
        });
        queueCloudPush();
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
      topBar(`
            <div class="crumbs"><a href="#/">Dersler</a> / ${escapeHtml(course.name)}</div>
            <h1>${escapeHtml(course.name)}</h1>
            <div class="meta">${escapeHtml(course.code || "")}</div>
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
      topBar(`
            <div class="crumbs">
              <a href="#/">Dersler</a> /
              <a href="#/course/${course.id}">${escapeHtml(course.name)}</a> /
              Hafta ${week.weekNumber}
            </div>
            <h1>Hafta ${week.weekNumber}</h1>
            <div class="meta">${escapeHtml(week.title || "Slaytlar ve özet")}</div>
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

  return {
    start: async () => {
      await migrateLiveClassUrls();
      await render();
      startLiveWatcher();
      document.addEventListener("visibilitychange", async () => {
        if (document.hidden) return;
        if (document.activeElement && document.activeElement.tagName === "TEXTAREA") return;
        try {
          await pullCloudNotes();
          await render();
        } catch (error) {
          console.warn("cloud pull", error);
        }
      });
    },
  };
})();

App.start();
