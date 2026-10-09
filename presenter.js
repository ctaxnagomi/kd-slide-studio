/* ============================================================
   KRACKED_OS — Slide Studio: parse decks + fullscreen presenter
   lightweight · vanilla · PPTX unzipped in-browser
   ============================================================ */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var THEMES = ["kd", "pink", "game", "doodle"];
  var THEME_NAMES = { kd: "KD Theme", pink: "KD Pink theme", game: "KD Gamified theme", doodle: "KD Doodle theme" };

  window.KD = window.KD || {};
  window.KD.theme = "kd";
  window.KD.presenterOpen = false;

  /* =========================================================
     DEMO DECK (works before the user uploads anything)
     ========================================================= */
  function demoDeck() {
    return {
      name: "demo",
      slides: [
        { title: "KRACKED_OS", kicker: "KrackedDevs creative bounty 2026",
          body: ["Three low-poly brains: BUILD · LEARN · EARN",
                 "Wheel = horizontal parallax, never page scroll",
                 "Hold the dial 180ms, rotate a full 360°"],
          notes: "Welcome line. Mention: everything stays inside the viewport." },
        { title: "Hold, then rotate", kicker: "navigation model",
          body: ["Press + hold the floating ParentSelector",
                 "Ring appears, button presses in",
                 "Rotate clockwise or counter-clockwise to cycle 14 child pages",
                 "Release to lock · short tap = next"],
          notes: "Point at the indicator on the left — it tracks the same index." },
        { title: "Slide Studio", kicker: "the new section",
          body: ["Upload .pptx / .md / .txt — parsed in the browser",
                 "Or paste slides & keynote prompts, split on ---",
                 "Keep every line of content inside each slide",
                 "Pick one of four KD backgrounds"],
          notes: "PPTX is a zip: we read it with DecompressionStream, zero libraries." },
        { title: "Four backgrounds", kicker: "theme picker",
          body: ["KD Theme — ghibli low-poly teal",
                 "KD Pink theme — watercolour rose",
                 "KD Gamified theme — arcade scoreboard",
                 "KD Doodle theme — paper + marker ink"],
          notes: "Press M in the presenter to cycle live." },
        { title: "Present fullscreen", kicker: "tools",
          body: ["Arrows / swipe / click zones to navigate",
                 "Pen, laser, grid overview, timer, blackout",
                 "F for fullscreen · ? for shortcuts · Esc to exit"],
          notes: "All of it vanilla JS. No frameworks on this stage." }
      ]
    };
  }

  window.KD.deck = demoDeck();
  window.KD.parseAny = parseAny;
  window.KD.parseText = parseText;

  /* =========================================================
     TEXT / PROMPT PARSING
     ========================================================= */
  function cleanLine(s) {
    return s.replace(/\s+/g, " ").replace(/^[-–—•*·\u2022]\s*/, "").trim();
  }

  function parseText(src) {
    var raw = String(src || "").replace(/\r\n?/g, "\n");
    if (!raw.trim()) return null;

    var lines = raw.split("\n");
    var chunks = [], cur = [];
    lines.forEach(function (l) {
      var t = l.trim();
      var isBreak = t === "\f" ||
        /^(-{3,}|={3,})$/.test(t) ||
        /^#{1,3}\s*[Ss]lide\b/i.test(t) ||
        /^\*{3,}$/.test(t);
      if (isBreak) {
        if (cur.join("").trim()) chunks.push(cur);
        cur = [];
        return;
      }
      cur.push(l);
    });
    if (cur.join("").trim()) chunks.push(cur);

    var slides = [];
    chunks.forEach(function (chunk, ci) {
      var lines = chunk.map(function (l) { return l.trim(); }).filter(function (l) { return l.length; });
      if (!lines.length) return;
      var title = cleanLine(lines[0]).replace(/^(slide\s*\d+\s*[:\-–—]\s*)/i, "").trim();
      if (!title) title = "Slide " + (ci + 1);
      var body = [], notes = [], inNotes = false, kicker = "";
      for (var i = 1; i < lines.length; i++) {
        var l = lines[i];
        if (/^(notes?|speaker)\s*[:\-–—]/i.test(l)) {
          inNotes = true;
          notes.push(cleanLine(l.replace(/^(notes?|speaker)\s*[:\-–—]\s*/i, "")));
          continue;
        }
        if (inNotes) { notes.push(cleanLine(l)); continue; }
        if (!kicker && !body.length && i === 1 && !/^[-–—•*·]/.test(l) && l.length <= 64) {
          kicker = cleanLine(l);   // kept, never dropped
          continue;
        }
        body.push(cleanLine(l));
      }
      slides.push({ title: title, kicker: kicker, body: body, notes: notes.join(" ") });
    });
    if (!slides.length) return null;
    return { name: "pasted", slides: slides };
  }

  /* =========================================================
     MINIMAL ZIP READER (PPTX / KEY packages)
     ========================================================= */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("no-inflate");
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(buf) {
    var dv = new DataView(buf);
    var bytes = new Uint8Array(buf);
    // EOCD — scan backwards for 0x06054b50
    var eocd = -1;
    for (var i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("not-zip");
    var count = dv.getUint16(eocd + 10, true);
    var cdOff = dv.getUint32(eocd + 16, true);
    var entries = [];
    var p = cdOff;
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true);
      var csize = dv.getUint32(p + 20, true);
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var cmtLen = dv.getUint16(p + 32, true);
      var lho = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name: name, method: method, csize: csize, lho: lho });
      p += 46 + nameLen + extraLen + cmtLen;
    }

    async function read(entry) {
      var lh = entry.lho;
      if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error("bad-local");
      var nl = dv.getUint16(lh + 26, true);
      var el = dv.getUint16(lh + 28, true);
      var start = lh + 30 + nl + el;
      var raw = bytes.subarray(start, start + entry.csize);
      if (entry.method === 0) return raw;
      if (entry.method === 8) return await inflateRaw(raw);
      throw new Error("method-" + entry.method);
    }
    return { entries: entries, read: read };
  }

  function decodeEntities(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(+d); })
      .replace(/&amp;/g, "&");
  }

  function xmlTexts(xml) {
    var out = [], seen = {};
    var re = /<(?:a|p|w|c|d|m):t[^>]*>([\s\S]*?)<\/(?:a|p|w|c|d|m):t>/g, m;
    while ((m = re.exec(xml))) {
      var t = decodeEntities(m[1].replace(/<[^>]+>/g, ""));
      if (t.trim() && !seen[t]) { out.push(t); seen[t] = true; }
    }
    if (out.length === 0) {
      var re2 = /<text[^>]*>([\s\S]*?)<\/text>/gi;
      while ((m = re2.exec(xml))) {
        var t2 = decodeEntities(m[1].replace(/<[^>]+>/g, ""));
        if (t2.trim() && !seen[t2]) { out.push(t2); seen[t2] = true; }
      }
    }
    return out;
  }

  function numKey(s) { return (s.match(/\d+/g) || ["0"]).map(function (n) { return String(+n).padStart(6, "0"); }).join("-"); }

  async function parsePptx(file) {
    var buf = await file.arrayBuffer();
    var zip;
    try { zip = await readZip(buf); }
    catch (e) { throw new Error("This file is not a readable .pptx package."); }

    var isKey = zip.entries.some(function (e) { return /^ppt\/|iwa|Index\/|IWA\//i.test(e.name); }) === false &&
                zip.entries.some(function (e) { return /\.iwa$/i.test(e.name) || /^Index\//.test(e.name); });
    if (isKey) throw new Error("Keynote .key uses iWork compression — export to PPTX or paste the slide prompts instead.");

    var slideNames = zip.entries
      .filter(function (e) { return /^ppt\/slides\/slide\d+\.xml$/i.test(e.name); })
      .sort(function (a, b) { return numKey(a.name) < numKey(b.name) ? -1 : 1; });
    if (!slideNames.length) throw new Error("No slides found inside that package.");

    var noteMap = {};
    var noteNames = zip.entries.filter(function (e) { return /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(e.name); });
    for (var q = 0; q < noteNames.length; q++) {
      try {
        var nx = new TextDecoder().decode(await zip.read(noteNames[q]));
        noteMap[noteNames[q].name.replace(/^ppt\/notesSlides\/notesSlide|\.xml$/gi, "")] = xmlTexts(nx).join(" ");
      } catch (e) { /* notes are optional */ }
    }

    var slides = [];
    for (var s = 0; s < slideNames.length; s++) {
      var xml = new TextDecoder().decode(await zip.read(slideNames[s]));
      var parts = xmlTexts(xml).filter(function (t) { return t.trim().length; });
      if (!parts.length) { slides.push({ title: "Slide " + (s + 1), body: ["(empty slide)"], notes: "" }); continue; }
      var key = slideNames[s].name.replace(/^ppt\/slides\/slide|\.xml$/gi, "");
      slides.push({
        title: parts.length > 1 ? parts[0] : parts[0],
        body: parts.slice(1),
        notes: noteMap[key] || ""
      });
    }
    return { name: file.name.replace(/\.[^.]+$/, ""), slides: slides };
  }

  async function parseAny(file) {
    var name = file.name || "";
    var ext = (name.match(/\.([^.]+)$/) || [,""])[1].toLowerCase();
    if (ext === "pptx" || ext === "potx" || ext === "ppsx") return await parsePptx(file);
    if (ext === "key") throw new Error("Keynote .key uses iWork compression — export to PPTX, or paste the slide prompts in the box.");
    if (ext === "pdf") throw new Error("PDF text streams are not parsed here — paste the prompts instead (fast & exact).");
    var text = await file.text();
    if (ext === "html" || ext === "htm") {
      var doc = new DOMParser().parseFromString(text, "text/html");
      var out = [], cur = null;
      Array.prototype.forEach.call(doc.body.querySelectorAll("h1,h2,h3,p,li"), function (el) {
        var t = el.textContent.trim(); if (!t) return;
        if (/^H[123]$/.test(el.tagName)) { cur = { title: t, body: [], notes: "" }; out.push(cur); }
        else if (cur) cur.body.push(t);
      });
      if (out.length) return { name: name.replace(/\.[^.]+$/, ""), slides: out };
    }
    var deck = parseText(text);
    if (!deck) throw new Error("Could not read any slides out of that file.");
    deck.name = name.replace(/\.[^.]+$/, "");
    return deck;
  }

  /* =========================================================
     SLIDE SECTION WIRING
     ========================================================= */
  var deckStatus = $("#deckStatus");
  var pasteBox = $("#pasteBox");

  function setDeck(deck) {
    window.KD.deck = deck;
    var n = deck.slides.length;
    deckStatus.textContent = "deck: " + deck.name + " · " + n + " slide" + (n === 1 ? "" : "s");
    if (window.KD.burst) window.KD.burst(Math.min(24, 8 + n));
    if (window.KD.ping) window.KD.ping(760, 0.08);
  }

  function fail(msg) {
    deckStatus.textContent = "✕ " + msg;
    deckStatus.style.color = "#ffb3c0";
    setTimeout(function () { deckStatus.style.color = ""; }, 4000);
  }

  // file upload
  var dropzone = $("#dropzone"), fileInput = $("#fileInput");
  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("is-over"); $("#dropHint").textContent = "release to parse"; });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("is-over"); $("#dropHint").textContent = "click or drop a file"; });
  });
  dropzone.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener("change", function () { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

  async function handleFile(file) {
    $("#dropHint").textContent = "parsing " + file.name + " …";
    try {
      var deck = await parseAny(file);
      setDeck(deck);
      $("#dropHint").textContent = "✓ " + deck.slides.length + " slides ready";
    } catch (err) {
      fail(err.message || "Could not read that file.");
      $("#dropHint").textContent = "click or drop a file";
    }
  }

  // paste
  $("#loadPaste").addEventListener("click", function () {
    var deck = parseText(pasteBox.value);
    if (!deck) return fail("Paste at least one slide, then press Load deck.");
    setDeck(deck);
  });
  $("#loadDemo").addEventListener("click", function () { setDeck(demoDeck()); });
  $("#clearDeck").addEventListener("click", function () {
    pasteBox.value = "";
    setDeck(demoDeck());
    $("#dropHint").textContent = "click or drop a file";
  });
  if ($("#btnCopyFormat")) $("#btnCopyFormat").addEventListener("click", copyDeckFormat);

  // themes
  function applyTheme(name, silent) {
    window.KD.theme = name;
    $$(".theme-card").forEach(function (c) {
      var on = c.dataset.theme === name;
      c.classList.toggle("is-on", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
    var deck = $("#deck");
    deck.className = "deck theme-" + name;
    if (!silent && window.KD.ping) window.KD.ping(600, 0.05);
  }
  $$(".theme-card").forEach(function (card) {
    card.addEventListener("click", function () { applyTheme(card.dataset.theme); });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); applyTheme(card.dataset.theme); }
    });
  });
  applyTheme("kd", true);

  /* =========================================================
     PRESENTER
     ========================================================= */
  var pres = $("#presenter"), deckEl = $("#deck"), ink = $("#ink"), ictx = ink.getContext("2d");
  var laser = $("#laser"), gridView = $("#gridView"), blackout = $("#blackout"), help = $("#presHelp");
  var bar = $("#presBar"), timerEl = $("#presTimer");
  var cur = 0, mode = "none"; // none | pen | laser
  var strokes = [];
  var inkColor = "#ffd166";
  var idleT = null, timerInt = null, timerOn = false, timerSec = 0;
  var drawing = null;
  var swipe = null;

  window.KD.sizeInk = sizeInk;

  function copyDeckFormat() {
    if (!window.KD.deck || !window.KD.deck.slides || window.KD.deck.slides.length === 0) return;
    var lines = [];
    window.KD.deck.slides.forEach(function (sl, i) {
      lines.push("Slide " + (i + 1) + ": " + (sl.title || "Untitled"));
      if (sl.kicker) lines.push(sl.kicker);
      if (sl.body && sl.body.length) {
        sl.body.forEach(function (b) { lines.push("- " + b); });
      }
      if (sl.notes) lines.push("Notes: " + sl.notes);
      lines.push("---");
    });
    var text = lines.join("
");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast("Copied deck format to clipboard");
      }, function () {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied deck format to clipboard"); } catch (e) { toast("Copy failed"); }
    document.body.removeChild(ta);
  }

  function sizeInk() {
    var r = pres.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    ink.width = Math.max(1, Math.round(r.width * dpr));
    ink.height = Math.max(1, Math.round(r.height * dpr));
    ink.style.width = r.width + "px";
    ink.style.height = r.height + "px";
    ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawInk();
  }

  function themeInk() {
    return window.KD.theme === "doodle" ? "#1a1a1a" :
           window.KD.theme === "pink" ? "#ff9ec4" :
           window.KD.theme === "game" ? "#f5c542" : "#ffd166";
  }

  function renderSlides() {
    var deck = window.KD.deck;
    deckEl.innerHTML = "";
    deck.slides.forEach(function (s, i) {
      var art = document.createElement("article");
      art.className = "slide fit" + (i === cur ? " is-on" : "");
      var html = '<span class="slide-no mono">' + String(i + 1).padStart(2, "0") + " / " + String(deck.slides.length).padStart(2, "0") + "</span>";
      if (s.kicker) html += '<div class="slide-kicker">' + esc(s.kicker) + "</div>";
      html += '<h2 class="slide-title">' + esc(s.title || "Untitled") + "</h2>";
      if (s.body && s.body.length) {
        html += '<ul class="slide-body">' + s.body.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>";
      }
      if (s.notes) html += '<p class="slide-notes">' + esc(s.notes) + "</p>";
      art.innerHTML = html;
      deckEl.appendChild(art);
    });
    $("#presTitle").textContent = (deck.name || "deck").toUpperCase();
    buildGrid();
    showSlide(cur, true);
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function showSlide(i, silent) {
    var n = window.KD.deck.slides.length;
    cur = ((i % n) + n) % n;
    $$(".slide", deckEl).forEach(function (el, k) { el.classList.toggle("is-on", k === cur); });
    $("#presCount").textContent = (cur + 1) + " / " + n;
    $("#presFill").style.width = (((cur + 1) / n) * 100).toFixed(2) + "%";
    $$(".grid-thumb", gridView).forEach(function (t, k) { t.classList.toggle("is-cur", k === cur); });
    clearInk();
    if (!silent && window.KD.ping) window.KD.ping(430 + (cur % 5) * 45, 0.05);
  }

  function buildGrid() {
    gridView.innerHTML = "";
    window.KD.deck.slides.forEach(function (s, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "grid-thumb" + (i === cur ? " is-cur" : "");
      b.innerHTML = '<span class="mono">SLIDE ' + String(i + 1).padStart(2, "0") + "</span><b>" +
        esc(s.title || "Untitled") + "</b><i>" + esc((s.body || []).join(" · ")) + "</i>";
      b.addEventListener("click", function () { showSlide(i); toggleGrid(false); });
      gridView.appendChild(b);
    });
  }

  /* ---- ink ---- */
  function redrawInk() {
    var r = pres.getBoundingClientRect();
    ictx.clearRect(0, 0, r.width, r.height);
    var list = strokes[cur] || [];
    list.forEach(function (st) {
      ictx.beginPath();
      ictx.strokeStyle = st.c;
      ictx.lineWidth = st.w;
      ictx.lineCap = "round";
      ictx.lineJoin = "round";
      st.pts.forEach(function (p, i) { i ? ictx.lineTo(p[0], p[1]) : ictx.moveTo(p[0], p[1]); });
      ictx.stroke();
    });
  }
  function clearInk() { strokes[cur] = []; redrawInk(); }

  function localXY(e) {
    var r = pres.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  pres.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".pres-bar, .grid-view, .pres-help")) return;
    wake();
    swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (mode === "pen") {
      var p = localXY(e);
      drawing = { c: inkColor, w: 4, pts: [p] };
      (strokes[cur] = strokes[cur] || []).push(drawing);
      try { pres.setPointerCapture(e.pointerId); } catch (err) {}
    }
  });
  pres.addEventListener("pointermove", function (e) {
    wake();
    if (mode === "laser") {
      laser.style.left = e.clientX + "px";
      laser.style.top = e.clientY + "px";
    }
    if (drawing) {
      drawing.pts.push(localXY(e));
      redrawInk();
    }
  });
  function endStroke(e) {
    if (drawing) { drawing = null; try { pres.releasePointerCapture(e.pointerId); } catch (err) {} }
    if (swipe && mode === "none") {
      var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y, dt = Date.now() - swipe.t;
      if (dt < 700 && Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.4) showSlide(cur + (dx < 0 ? 1 : -1));
      else if (dt < 400 && Math.abs(dx) < 12 && Math.abs(dy) < 12 && !e.target.closest(".pres-bar, .grid-view, .pres-help")) {
        var r = pres.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
        if (f < 0.3) showSlide(cur - 1);
        else if (f > 0.7) showSlide(cur + 1);
      }
    }
    swipe = null;
  }
  pres.addEventListener("pointerup", endStroke);
  pres.addEventListener("pointercancel", endStroke);

  /* ---- toolbar ---- */
  function wake() {
    bar.classList.remove("is-idle");
    clearTimeout(idleT);
    idleT = setTimeout(function () {
      if (!gridView.hidden || !help.hidden) return;
      bar.classList.add("is-idle");
    }, 2600);
  }

  function setMode(m) {
    mode = mode === m ? "none" : m;
    laser.classList.toggle("is-on", mode === "laser");
    $('[data-act="pen"]').classList.toggle("is-on", mode === "pen");
    $('[data-act="laser"]').classList.toggle("is-on", mode === "laser");
    pres.style.cursor = mode === "pen" ? "crosshair" : mode === "laser" ? "none" : "";
    inkColor = themeInk();
    if (window.KD.ping) window.KD.ping(mode === "none" ? 330 : 660, 0.05);
  }
  function toggleGrid(force) {
    var on = force == null ? gridView.hidden : force;
    gridView.hidden = !on;
    wake();
  }
  function toggleTimer() {
    timerOn = !timerOn;
    $('[data-act="timer"]').classList.toggle("is-on", timerOn);
    if (timerOn) {
      timerInt = setInterval(function () {
        timerSec++;
        var m = Math.floor(timerSec / 60), s = timerSec % 60;
        timerEl.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      }, 1000);
    } else clearInterval(timerInt);
    if (window.KD.ping) window.KD.ping(timerOn ? 780 : 300, 0.05);
  }
  function cycleTheme() {
    var i = THEMES.indexOf(window.KD.theme);
    applyTheme(THEMES[(i + 1) % THEMES.length]);
  }
  function toggleBlack() {
    blackout.hidden = !blackout.hidden;
    $('[data-act="black"]').classList.toggle("is-on", !blackout.hidden);
  }
  async function toggleFull() {
    try {
      if (!document.fullscreenElement) await pres.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) { /* fullscreen may be blocked — presenter still works */ }
  }

  bar.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    wake();
    var a = b.dataset.act;
    if (a === "prev") showSlide(cur - 1);
    else if (a === "next") showSlide(cur + 1);
    else if (a === "pen") setMode("pen");
    else if (a === "laser") setMode("laser");
    else if (a === "clear") { clearInk(); if (window.KD.ping) window.KD.ping(300, 0.05); }
    else if (a === "grid") toggleGrid();
    else if (a === "timer") toggleTimer();
    else if (a === "theme") cycleTheme();
    else if (a === "black") toggleBlack();
    else if (a === "full") toggleFull();
    else if (a === "help") { help.hidden = !help.hidden; wake(); }
    else if (a === "exit") closePresenter();
  });

  /* ---- open / close ---- */
  function openPresenter() {
    var deck = window.KD.deck;
    if (!deck || !deck.slides || !deck.slides.length) return;
    cur = 0;
    window.KD.presenterOpen = true;
    pres.hidden = false;
    applyTheme(window.KD.theme || "kd", true);
    renderSlides();
    requestAnimationFrame(function () { sizeInk(); toggleGrid(false); });
    wake();
    if (window.KD.ping) window.KD.ping(700, 0.1);
    if (window.KD.burst) window.KD.burst(24);
    if (document.fullscreenEnabled) {
      pres.requestFullscreen().catch(function () {});
    }
  }

  function closePresenter() {
    window.KD.presenterOpen = false;
    pres.hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    if (timerOn) toggleTimer();
    blackout.hidden = true;
    gridView.hidden = true;
    help.hidden = true;
    $('[data-act="black"]').classList.remove("is-on");
    mode = "none";
    laser.classList.remove("is-on");
    if (window.KD.resize) window.KD.resize();
    if (window.KD.ping) window.KD.ping(330, 0.07);
  }

  $("#presentBtn").addEventListener("click", openPresenter);
  $("#presentBtn2").addEventListener("click", openPresenter);

  document.addEventListener("fullscreenchange", function () {
    if (!document.fullscreenElement && window.KD.presenterOpen && !pres.hidden) closePresenter();
    setTimeout(sizeInk, 60);
  });

  /* ---- keyboard ---- */
  document.addEventListener("keydown", function (e) {
    if (!window.KD.presenterOpen) return;
    var typing = e.target.matches && e.target.matches("input, textarea");
    if (typing) return;
    wake();
    var k = e.key;
    if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") { e.preventDefault(); showSlide(cur + 1); }
    else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") { e.preventDefault(); showSlide(cur - 1); }
    else if (k === "Home") showSlide(0);
    else if (k === "End") showSlide(window.KD.deck.slides.length - 1);
    else if (k === "g" || k === "G") toggleGrid();
    else if (k === "p" || k === "P") setMode("pen");
    else if (k === "l" || k === "L") setMode("laser");
    else if (k === "c" || k === "C") clearInk();
    else if (k === "t" || k === "T") toggleTimer();
    else if (k === "m" || k === "M") cycleTheme();
    else if (k === "b" || k === "B") toggleBlack();
    else if (k === "f" || k === "F") toggleFull();
    else if (k === "?" || k === "/") { e.preventDefault(); help.hidden = !help.hidden; }
    else if (k === "Escape") {
      if (!help.hidden) help.hidden = true;
      else if (!gridView.hidden) toggleGrid(false);
      else if (document.fullscreenElement) { /* browser exits fullscreen → we close after */ }
      else closePresenter();
    }
  });

  window.addEventListener("resize", function () { if (window.KD.presenterOpen) sizeInk(); });
  deckStatus.textContent = "deck: demo · " + window.KD.deck.slides.length + " slides";
})();
