/* ============================================================
   KRACKED_OS — stage brains, intro, ParentSelector navigation
   vanilla JS · no dependencies
   ============================================================ */
(function () {
  "use strict";

  /* ---------- viewport / gesture lockdown (template rules) ---------- */
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("gesturechange", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("gestureend", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", function (e) {
    if (e.target.closest("#parentSelector, #stage canvas, .theme-card")) e.preventDefault();
  });
  document.addEventListener("dragstart", function (e) { e.preventDefault(); });
  document.addEventListener("dragover", function (e) { e.preventDefault(); });
  document.addEventListener("drop", function (e) {
    if (!e.target.closest || !e.target.closest("#dropzone")) e.preventDefault();
  });

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  /* =========================================================
     NAVIGATION DATA MODEL (from the uploaded diagram)
     ========================================================= */
  var PARENTS = [
    { id: "PARENTITEM1", page: "ParentPage1", title: "Home", items: [
      ["featured", "FeaturedDevelopers"], ["bulletin", "BulletinBoard"], ["xfeed", "x Feed"],
      ["hackathon", "UpcomingHackathon"], ["qualifier", "AgenticQualifier2026"]
    ]},
    { id: "PARENTITEM2", page: "ParentPage2", title: "Community", items: [
      ["community-home", "CommunityHome"], ["events", "Events"], ["guilds", "Guilds"],
      ["showcase", "Showcase"], ["bounties", "Bounties"], ["jobs", "Jobs"]
    ]},
    { id: "PARENTITEM3", page: "ParentPage3", title: "CSR / Learning", items: [
      ["csr", "CSRProjects"], ["volunteer", "VolunteerForm"], ["vision", "Vision & Goals"],
      ["courses", "CoursesHTML-CSS-JS"], ["milestone", "x Milestone"], ["gallery", "Gallery"]
    ]},
    { id: "PARENTITEM4", page: "ParentPage4", title: "Studio", items: [
      ["slides", "SlideStudio"], ["present", "PresentMode"], ["repo", "RepoNotes"]
    ]}
  ];

  var FLAT = [];
  PARENTS.forEach(function (p, pi) {
    p.items.forEach(function (it, ii) {
      FLAT.push({ key: it[0], nav: it[1], parentId: p.id, page: p.page, title: p.title, pi: pi, ii: ii });
    });
  });
  var TOTAL = FLAT.length;
  var STEP = (Math.PI * 2) / TOTAL;

  var state = {
    index: 0,          // locked nav index
    angle: 0,          // rendered (inertia) angle
    targetAngle: 0,    // target angle
    held: false,
    rotating: false,
    open: false,
    rotations: 0,
    sound: true
  };

  window.KD = window.KD || {};
  window.KD.state = state;
  window.KD.FLAT = FLAT;

  /* =========================================================
     CANVAS — three low-poly grease-pencil brains
     ========================================================= */
  var canvas = $("#brains");
  var ctx = canvas.getContext("2d");
  var W = 0, H = 0, DPR = 1;
  var DEPTHS = [0.4, 0.7, 1.0];
  var offset = [0, 0, 0];
  var pointer = { x: 0, y: 0, nx: 0, ny: 0 };
  var brains = [];
  var labelEls = $$(".brain-label");
  var particleCount = 0;
  var burst = []; // transient shards
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function makeBrain(n, R) {
    var pts = [];
    var GA = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < n; i++) {
      var rr = Math.sqrt((i + 0.6) / n);
      var a = i * GA;
      var rad = rr * R * (0.82 + Math.random() * 0.36);
      pts.push({
        x: Math.cos(a) * rad * 1.18,
        y: Math.sin(a) * rad * 0.88,
        ph: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 0.8,
        amp: 1.5 + Math.random() * 2.6
      });
    }
    // k-neighbour graph -> triangles
    var nb = pts.map(function (p, i) {
      var d = pts.map(function (q, j) {
        if (i === j) return null;
        var dx = p.x - q.x, dy = p.y - q.y;
        return { j: j, d: dx * dx + dy * dy };
      }).filter(Boolean).sort(function (a, b) { return a.d - b.d; });
      return d.slice(0, 6).map(function (o) { return o.j; });
    });
    var tris = [], seen = {};
    for (i = 0; i < n; i++) {
      for (var k = 0; k < nb[i].length; k++) {
        var j = nb[i][k];
        if (j < i) continue;
        var shared = nb[i].filter(function (x) { return nb[j].indexOf(x) > -1 && x !== i && x !== j; });
        if (!shared.length) continue;
        var m = Math.min.apply(null, shared);
        var key = [i, j, m].sort(function (a, b) { return a - b; }).join("-");
        if (seen[key]) continue;
        seen[key] = 1;
        tris.push([i, j, m]);
      }
    }
    // silhouette edges (used by exactly one triangle)
    var ec = {};
    tris.forEach(function (t) {
      [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(function (e) {
        var k = e[0] < e[1] ? e[0] + "-" + e[1] : e[1] + "-" + e[0];
        ec[k] = (ec[k] || 0) + 1;
      });
    });
    var edges = [];
    tris.forEach(function (t) {
      [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]].forEach(function (e) {
        var k = e[0] < e[1] ? e[0] + "-" + e[1] : e[1] + "-" + e[0];
        if (ec[k] === 1) edges.push([e[0], e[1]]);
      });
    });
    return { pts: pts, tris: tris, edges: edges, R: R };
  }

  function layoutBrains() {
    var small = W < 900;
    var R = clamp(Math.min(W * (small ? 0.16 : 0.105), H * 0.19), 56, 165);
    var n = small ? 46 : 74;
    brains = [makeBrain(n, R), makeBrain(n, R * 0.94), makeBrain(n, R * 1.04)];
    particleCount = brains.reduce(function (s, b) { return s + b.pts.length; }, 0);
    var t = $("#tParticles"); if (t) t.textContent = particleCount + " pts / " +
      brains.reduce(function (s, b) { return s + b.tris.length; }, 0) + " faces";
  }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    var r = $("#stage").getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layoutBrains();
    sizeInk();
    var tv = $("#tView"); if (tv) tv.textContent = W + "x" + H;
  }

  function brainCenters() {
    var mobile = W < 700;
    var xs = mobile ? [0.19, 0.5, 0.81] : [0.25, 0.5, 0.75];
    var cy = H * (mobile ? 0.42 : 0.40);
    return xs.map(function (f) { return { x: W * f, y: cy }; });
  }

  var t0 = performance.now();
  var frames = 0, fpsT = performance.now(), fps = 60;

  function draw(now) {
    var t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    var centers = brainCenters();

    for (var b = 0; b < 3; b++) {
      var br = brains[b]; if (!br) continue;
      var cx = centers[b].x + offset[b] + pointer.nx * 14 * DEPTHS[b];
      var cy = centers[b].y + pointer.ny * 8 * DEPTHS[b];
      var lbl = labelEls[b];
      if (lbl) lbl.style.transform = "translate(calc(-50% + " + (offset[b] + pointer.nx * 14 * DEPTHS[b]).toFixed(1) + "px), " +
        (pointer.ny * 8 * DEPTHS[b]).toFixed(1) + "px)";
      var pts = br.pts, P = new Array(pts.length);

      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var jx = reduced ? 0 : Math.sin(t * p.sp + p.ph) * p.amp;
        var jy = reduced ? 0 : Math.cos(t * p.sp * 0.83 + p.ph * 1.3) * p.amp;
        P[i] = [cx + p.x + jx, cy + p.y + jy];
      }

      // fills
      ctx.lineJoin = "round";
      for (var k = 0; k < br.tris.length; k++) {
        var tr = br.tris[k];
        var a = P[tr[0]], c = P[tr[1]], d = P[tr[2]];
        var shade = 0.16 + 0.2 * ((k % 7) / 7) + 0.06 * Math.sin(t * 0.6 + k);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
        ctx.fillStyle = (k % 3 === 0)
          ? "rgba(122,155,176," + shade.toFixed(3) + ")"
          : "rgba(74,124,126," + (shade + 0.1).toFixed(3) + ")";
        ctx.fill();
        ctx.strokeStyle = "rgba(10,18,20,0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      // silhouette — bold black sketch outline
      ctx.beginPath();
      for (var e = 0; e < br.edges.length; e++) {
        var A = P[br.edges[e][0]], B = P[br.edges[e][1]];
        ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
      }
      ctx.strokeStyle = "#0a1214";
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // node dots (grease-pencil grain)
      ctx.fillStyle = "rgba(232,224,208,0.5)";
      for (var d2 = 0; d2 < pts.length; d2 += 4) {
        ctx.beginPath(); ctx.arc(P[d2][0], P[d2][1], 1.4, 0, 6.283); ctx.fill();
      }
    }

    // transient burst shards
    for (var s = burst.length - 1; s >= 0; s--) {
      var sh = burst[s];
      sh.life -= 0.016;
      if (sh.life <= 0) { burst.splice(s, 1); continue; }
      sh.x += sh.vx; sh.y += sh.vy; sh.vy += 0.05; sh.r += sh.vr;
      ctx.save();
      ctx.translate(sh.x, sh.y); ctx.rotate(sh.r);
      ctx.globalAlpha = Math.max(0, sh.life);
      ctx.beginPath();
      ctx.moveTo(-sh.s, sh.s * 0.6); ctx.lineTo(0, -sh.s); ctx.lineTo(sh.s, sh.s * 0.6); ctx.closePath();
      ctx.fillStyle = sh.c; ctx.fill();
      ctx.lineWidth = 1.6; ctx.strokeStyle = "#0a1214"; ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    frames++;
    if (now - fpsT > 500) {
      fps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0; fpsT = now;
      var tf = $("#tFps"); if (tf) tf.textContent = fps;
    }
    requestAnimationFrame(draw);
  }

  window.KD.burst = function (n, cx, cy) {
    var cols = ["#6b9a9c", "#7a9bb0", "#e8e0d0", "#c9e6d6", "#f4c7d4"];
    var c = brainCenters();
    cx = cx == null ? W / 2 : cx; cy = cy == null ? H / 2 : cy;
    for (var i = 0; i < (n || 26); i++) {
      var a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
      burst.push({
        x: cx + (Math.random() - 0.5) * 80, y: cy + (Math.random() - 0.5) * 80,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        s: 5 + Math.random() * 9, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
        life: 1 + Math.random() * 0.8, c: cols[i % cols.length]
      });
    }
    if (burst.length > 260) burst.splice(0, burst.length - 260);
  };

  /* =========================================================
     WHEEL → horizontal parallax (no page scroll)
     ========================================================= */
  var stage = $("#stage");
  var introWheelAcc = 0;

  stage.addEventListener("wheel", function (e) {
    var inScroller = e.target.closest && e.target.closest("#panelScroll, .grid-view, .pres-help, .paste textarea");
    if (inScroller) { setMotion(e.deltaY); return; }   // let content scroll natively
    e.preventDefault();
    setMotion(e.deltaY);

    if (!$("#intro").hidden) {
      if (e.deltaY > 0) {
        introWheelAcc += e.deltaY;
        if (introWheelAcc > 240) enterSite();
      } else introWheelAcc = Math.max(0, introWheelAcc + e.deltaY);
      return;
    }
    if (state.open) return; // panel open: wheel is reserved for parallax only outside
    var dx = e.deltaY * 0.16;
    for (var i = 0; i < 3; i++) offset[i] += dx * DEPTHS[i];
    clampOffsets();
  }, { passive: false });

  function clampOffsets() {
    var lim = W * 0.11;
    for (var i = 0; i < 3; i++) offset[i] = clamp(offset[i], -lim, lim);
  }

  var motionEl = $("#tMotion"), motionTimer = null;
  function setMotion(dy) {
    if (!motionEl) return;
    motionEl.textContent = dy > 0 ? "mwheeldown" : "mwheelup";
    clearTimeout(motionTimer);
    motionTimer = setTimeout(function () { motionEl.textContent = "idle"; }, 900);
  }

  /* =========================================================
     INTRO — "surprise me" + wheel to enter
     ========================================================= */
  var ICONS = [];
  for (var ii = 0; ii < 53; ii++) ICONS.push("assets/icons/wc-" + (ii < 10 ? "0" + ii : ii) + ".png");

  var LINES = [
    "a low-poly sketch interface for building, learning & earning.",
    "hold the dial, rotate the world, land where you meant to.",
    "paper outlines, grease-pencil brains, zero framework bloat.",
    "scroll down when you're ready — the brains are already moving.",
    "four themes, one deck, fullscreen forever.",
    "everything here fits inside the viewport. on purpose."
  ];
  var STICKER_TAGS = ["LUCKY STICKER", "BOUNTY CHARM", "SKETCH DROP", "GREASE PENCIL", "FIELD SAMPLE", "GUILD BADGE"];

  var surprises = 0, streak = 0, lastSticker = -1;

  function scatterIntro() {
    var host = $("#introScatter"); if (!host) return;
    host.innerHTML = "";
    var picks = [];
    while (picks.length < (W < 700 ? 5 : 10)) {
      var i = Math.floor(Math.random() * ICONS.length);
      if (picks.indexOf(i) === -1) picks.push(i);
    }
    picks.forEach(function (i, k) {
      var img = document.createElement("img");
      img.src = ICONS[i]; img.alt = "";
      img.style.left = (6 + Math.random() * 84) + "%";
      img.style.top = (8 + Math.random() * 74) + "%";
      img.style.animationDelay = (-Math.random() * 16) + "s";
      img.style.transform = "rotate(" + (Math.random() * 40 - 20) + "deg)";
      if (W < 700) img.style.width = img.style.height = "54px";
      host.appendChild(img);
      void k;
    });
  }

  function surprise() {
    surprises++; streak++;
    var line = $("#introLine");
    if (line) line.textContent = LINES[surprises % LINES.length];
    var i = Math.floor(Math.random() * ICONS.length);
    if (i === lastSticker) i = (i + 7) % ICONS.length;
    lastSticker = i;
    var slot = $("#stickerSlot");
    slot.innerHTML = "";
    var el = document.createElement("div");
    el.className = "sticker";
    el.innerHTML = '<img src="' + ICONS[i] + '" alt="" /><span class="sticker-txt"><b>' +
      STICKER_TAGS[surprises % STICKER_TAGS.length] + " #" + String(i).padStart(2, "0") +
      '</b><span class="mono">found by you · ' + new Date().toLocaleTimeString() + "</span></span>";
    slot.appendChild(el);
    var accents = ["#c9e6d6", "#f4c7d4", "#f5c542", "#a8e05f", "#9fd6ff", "#ffd8a8"];
    var ac = accents[surprises % accents.length];
    document.documentElement.style.setProperty("--accent", ac);
    $("#surpriseCount").textContent = "surprises: " + surprises + " · streak: " + streak;
    var intro = $("#intro");
    intro.classList.remove("is-shaking");
    void intro.offsetWidth;
    intro.classList.add("is-shaking");
    window.KD.burst(30);
    ping(520 + (surprises % 5) * 70, 0.09);
  }

  var entered = false;
  function enterSite() {
    if (entered) return;
    entered = true;
    var intro = $("#intro");
    intro.classList.add("is-leaving");
    window.KD.burst(60, W / 2, H * 0.42);
    ping(660, 0.14);
    setTimeout(function () {
      intro.hidden = true;
      $("#displayNameText").textContent = "DisplayPARENTITEM" + (FLAT[state.index].pi + 1) + "OverviewName";
      announce(FLAT[state.index]);
    }, 580);
  }

  $("#surpriseBtn").addEventListener("click", surprise);
  $("#scrollHint").addEventListener("click", enterSite);

  /* =========================================================
     SOUND (tiny WebAudio tick)
     ========================================================= */
  var actx = null;
  function ping(freq, dur) {
    if (!state.sound) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "square"; o.frequency.value = freq;
      g.gain.value = 0.035;
      o.connect(g); g.connect(actx.destination);
      var n = actx.currentTime;
      g.gain.setValueAtTime(0.035, n);
      g.gain.exponentialRampToValueAtTime(0.0008, n + (dur || 0.05));
      o.start(n); o.stop(n + (dur || 0.05) + 0.02);
    } catch (err) { /* audio is a luxury */ }
  }
  $("#btnSound").addEventListener("click", function () {
    state.sound = !state.sound;
    this.textContent = "TICK: " + (state.sound ? "ON" : "OFF");
    this.classList.toggle("ghost", !state.sound);
    if (state.sound) ping(700, 0.06);
  });
  window.KD.ping = ping;
  window.KD.sound = function () { return state.sound; };

  /* =========================================================
     INDICATOR PANEL (left)
     ========================================================= */
  var indNav = $("#indNav");
  PARENTS.forEach(function (p, pi) {
    var wrap = document.createElement("div");
    wrap.className = "ind-parent";
    var b = document.createElement("b");
    b.textContent = p.page + " · " + p.title;
    wrap.appendChild(b);
    p.items.forEach(function (it) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ind-link";
      btn.dataset.child = it[0];
      btn.dataset.parent = pi;
      btn.textContent = it[1];
      btn.addEventListener("click", function () { selectByKey(it[0], true); closeDrawer(); });
      wrap.appendChild(btn);
    });
    indNav.appendChild(wrap);
  });

  function closeDrawer() { $("#indicator").classList.remove("is-open"); }
  $("#btnPanelMenu").addEventListener("click", function () {
    $("#indicator").classList.toggle("is-open");
  });

  /* =========================================================
     PANEL + DISPLAY NAME
     ========================================================= */
  function announce(entry) {
    $("#panelCrumb").textContent = entry.page + " / " + entry.nav;
    $("#displayNameText").textContent = "Display" + entry.parentId + entry.nav.replace(/[^A-Za-z0-9]/g, "") + "Name";
    $("#tIndex").textContent = (state.index + 1) + " / " + TOTAL;
    $("#tParent").textContent = entry.parentId;
    $$(".ind-link").forEach(function (l) { l.classList.toggle("is-active", l.dataset.child === entry.key); });
  }

  function openPanel(entry) {
    state.open = true;
    var panel = $("#panel");
    panel.hidden = false;
    $$(".child").forEach(function (s) { s.classList.toggle("is-on", s.dataset.child === entry.key); });
    $("#panelScroll").scrollTop = 0;
    announce(entry);
    if (entry.key === "gallery" && !$("#stickerWall").childElementCount) fillWall();
  }

  function closePanel() {
    state.open = false;
    $("#panel").hidden = true;
    $$(".ind-link").forEach(function (l) { l.classList.remove("is-active"); });
    $("#panelCrumb").textContent = "ParentPage → ChildPage";
  }
  $("#btnClosePanel").addEventListener("click", function () { closePanel(); ping(360, 0.05); });

  function selectByKey(key, forceOpen) {
    var idx = -1;
    for (var i = 0; i < TOTAL; i++) if (FLAT[i].key === key) idx = i;
    if (idx < 0) return;
    var moved = idx !== state.index;
    state.index = idx;
    state.targetAngle = idx * STEP + Math.round((state.targetAngle - idx * STEP) / (Math.PI * 2)) * Math.PI * 2;
    state.angle = state.targetAngle;
    updateRing();
    announce(FLAT[idx]);
    if (forceOpen || state.open || moved) openPanel(FLAT[idx]);
    ping(420 + (idx % 6) * 55, 0.05);
  }

  function step(delta) {
    var i = (state.index + delta + TOTAL) % TOTAL;
    state.index = i;
    var base = Math.round(state.targetAngle / (Math.PI * 2)) * Math.PI * 2;
    state.targetAngle = base + i * STEP;
    updateRing();
    announce(FLAT[i]);
    openPanel(FLAT[i]);
    ping(430 + (i % 7) * 50, 0.05);
  }

  /* =========================================================
     PARENT SELECTOR — press+hold 180ms → 360° rotate
     ========================================================= */
  var sel = $("#parentSelector");
  var ring = $("#rotRing");
  var ringFg = ring.querySelector(".ring-fg");
  var wrap = $("#selectorWrap");
  var holdTimer = null, lastA = 0, holdStart = 0;

  function angleAt(e) {
    var r = sel.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return Math.atan2(e.clientY - cy, e.clientX - cx);
  }
  function updateRing() {
    var prog = ((state.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    ringFg.style.strokeDashoffset = String(327 - (327 * prog) / (Math.PI * 2));
    ring.style.transform = "translateX(-50%) scale(1) rotate(" + (state.angle * 180 / Math.PI) + "deg)";
  }

  sel.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    try { sel.setPointerCapture(e.pointerId); } catch (err) {}
    holdStart = performance.now();
    lastA = angleAt(e);
    state.held = true;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(function () {
      if (!state.held) return;
      state.rotating = true;
      sel.classList.add("is-held");
      ring.classList.add("is-on");
      wrap.classList.add("is-holding");
      $("#selHint").textContent = "ROTATING · RELEASE TO LOCK";
      ping(540, 0.06);
    }, 180);
  });

  sel.addEventListener("pointermove", function (e) {
    if (!state.rotating) return;
    e.preventDefault();
    var a = angleAt(e);
    var d = a - lastA;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    lastA = a;
    var before = state.index;
    state.targetAngle += d;
    var idx = ((Math.round(state.targetAngle / STEP) % TOTAL) + TOTAL) % TOTAL;
    if (idx !== before) {
      state.index = idx;
      announce(FLAT[idx]);
      ping(380 + (idx % 8) * 40, 0.04);
      var full = Math.floor(Math.abs(state.targetAngle) / (Math.PI * 2));
      if (full > state.rotations) {
        state.rotations = full;
        var md = $("#mDial"); if (md) md.textContent = full;
      }
    }
    updateRing();
  });

  function endHold(e) {
    if (!state.held) return;
    var quick = performance.now() - holdStart < 180;
    state.held = false;
    clearTimeout(holdTimer);
    if (state.rotating) {
      state.rotating = false;
      // inertia: snap to nearest item
      state.targetAngle = Math.round(state.targetAngle / STEP) * STEP;
      openPanel(FLAT[state.index]);
      ping(640, 0.07);
    } else if (quick) {
      step(1); // short tap = next child
    }
    sel.classList.remove("is-held");
    ring.classList.remove("is-on");
    wrap.classList.remove("is-holding");
    $("#selHint").textContent = "HOLD + ROTATE 360°";
    if (e) { try { sel.releasePointerCapture(e.pointerId); } catch (err) {} }
  }
  sel.addEventListener("pointerup", endHold);
  sel.addEventListener("pointercancel", endHold);
  sel.addEventListener("lostpointercapture", endHold);

  // inertia loop (smooth)
  (function inertia() {
    if (Math.abs(state.targetAngle - state.angle) > 0.0004) {
      state.angle = lerp(state.angle, state.targetAngle, reduced ? 1 : 0.16);
      updateRing();
    }
    requestAnimationFrame(inertia);
  })();

  /* =========================================================
     KEYBOARD / PAGE MOTION
     ========================================================= */
  document.addEventListener("keydown", function (e) {
    var typing = e.target.matches && e.target.matches("input, textarea, select");
    if (!$("#intro").hidden) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") { e.preventDefault(); enterSite(); }
      return;
    }
    if (typing) return;
    if (window.KD.presenterOpen) return; // presenter owns the keys
    if (e.key === "PageDown" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
    else if (e.key === "PageUp" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
    else if (e.key === "Escape") closePanel();
  });

  /* =========================================================
     TELEMETRY + POINTER
     ========================================================= */
  document.addEventListener("pointermove", function (e) {
    pointer.x = e.clientX; pointer.y = e.clientY;
    pointer.nx = (e.clientX / Math.max(1, W)) * 2 - 1;
    pointer.ny = (e.clientY / Math.max(1, H)) * 2 - 1;
    var tp = $("#tPointer");
    if (tp && frames % 4 === 0) tp.textContent = Math.round(e.clientX) + "," + Math.round(e.clientY);
  }, { passive: true });

  /* =========================================================
     MISC CONTENT BEHAVIOUR
     ========================================================= */
  function fillWall() {
    var w = $("#stickerWall");
    ICONS.forEach(function (src, i) {
      var img = document.createElement("img");
      img.src = src; img.alt = "sticker " + i; img.loading = "lazy";
      w.appendChild(img);
    });
  }

  var cdEl = $("#countdown");
  if (cdEl) {
    var target = Date.now() + (1000 * 60 * 60 * 38) + (1000 * 60 * 12);
    setInterval(function () {
      var d = Math.max(0, target - Date.now());
      var dd = Math.floor(d / 86400000), hh = Math.floor(d / 3600000) % 24,
          mm = Math.floor(d / 60000) % 60, ss = Math.floor(d / 1000) % 60;
      cdEl.textContent = String(dd).padStart(2, "0") + "d " + String(hh).padStart(2, "0") + "h " +
        String(mm).padStart(2, "0") + "m " + String(ss).padStart(2, "0") + "s";
    }, 1000);
  }

  var volForm = $("#volForm");
  if (volForm) volForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("#volName").value.trim() || "anonymous";
    $("#volNote").textContent = "status: " + name + " → " + $("#volTrack").value + " track queued ✓";
    ping(720, 0.08);
    window.KD.burst(18, W * 0.5, H * 0.5);
  });

  function sizeInk() { if (window.KD.sizeInk) window.KD.sizeInk(); }

  /* =========================================================
     BOOT
     ========================================================= */
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });
  resize();
  scatterIntro();
  announce(FLAT[0]);
  closePanel();
  requestAnimationFrame(draw);
  ping(480, 0.08);

  // keep an honest handle for the presenter
  window.KD.openPanelByKey = function (k) { selectByKey(k, true); };
  window.KD.icons = ICONS;
  window.KD.resize = resize;
})();

/* ---------- GO HOME EASTER EGG ---------- */
(function(){
  var goBtn = document.getElementById('goHomeBtn');
  var curtain = document.getElementById('curtain');
  var loading = document.getElementById('loadingCenter');
  var switchPanel = document.getElementById('switchPanel');
  var switchBtn = document.getElementById('switchBtn');
  var fah = document.getElementById('fahText');
  if (!goBtn || !curtain || !loading || !switchPanel || !switchBtn || !fah) return;
  var audio = new Audio('assets/mp3/fah.mp3');
  audio.preload = 'auto';
  audio.volume = 1.0;
  var started = false;
  goBtn.addEventListener('click', function(){
    if (started) return; started = true;
    goBtn.classList.add('is-hidden');
    curtain.hidden = false;
    requestAnimationFrame(function(){ curtain.classList.add('show'); });
    setTimeout(function(){
      curtain.classList.add('is-white');
      loading.hidden = false;
      requestAnimationFrame(function(){ loading.classList.add('show'); });
    }, 950);
    setTimeout(function(){
      loading.classList.remove('show');
      setTimeout(function(){ loading.hidden = true; }, 400);
      switchPanel.hidden = false;
      requestAnimationFrame(function(){ switchPanel.classList.add('show'); });
    }, 950 + 5000);
  });
  switchBtn.addEventListener('click', function(){
    if (switchBtn.disabled) return;
    switchBtn.disabled = true;
    switchBtn.classList.add('is-on');
    fah.hidden = false;
    requestAnimationFrame(function(){ fah.classList.add('show'); });
    audio.currentTime = 0;
    audio.play().catch(function(){});
    var redirect = function(){
      window.location.href = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    };
    audio.addEventListener('ended', redirect, { once: true });
    setTimeout(redirect, 6500);
  });
})();
