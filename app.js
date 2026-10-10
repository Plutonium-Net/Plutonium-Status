/*
 * Static Plutonium status page.
 *
 * Reads the Stelena status API cross-origin:
 *   - prefers the live WebSocket stream at <api>/status/ws
 *   - falls back to polling GET <api>/status if the socket keeps failing
 * The countdown is recomputed locally every 200ms against the server clock
 * (derived from each frame's sentAt) so it stays accurate between pushes.
 */
(function () {
  "use strict";

  var DEFAULT_API = "https://stelena.plutoniumnet.work";
  var STORAGE_KEY = "stelena:api";
  var POLL_MS = 5000;
  var WS_MAX_RETRIES = 5;
  var TICK_MS = 200;
  var STATUS_WS_PATH = "/status/ws";

  var el = {};
  [
    "conn", "conn-text", "sim-banner", "sim-text", "hero", "hero-label",
    "hero-note", "countdown", "countdown-bar", "n-up", "n-slow", "n-down", "n-total",
    "n-checked", "filters", "groups", "foot-source", "foot-updated", "foot-interval",
  ].forEach(function (id) {
    el[id] = document.getElementById(id);
  });

  var state = {
    api: resolveApi(),
    snapshot: null,
    filter: "all",
    offset: 0,
    mode: "connecting",
    socket: null,
    retries: 0,
    reconnectTimer: null,
    pollTimer: null,
    tickTimer: null,
    stopped: false,
  };

  // ---- API base resolution -------------------------------------------------

  function normalizeApi(value) {
    var text = String(value == null ? "" : value).trim().replace(/\/+$/, "");
    if (!text) return DEFAULT_API;
    if (!/^https?:\/\//i.test(text)) text = "https://" + text;
    return text;
  }

  function resolveApi() {
    var fromQuery = new URLSearchParams(location.search).get("api");
    var fromStore = null;
    try { fromStore = localStorage.getItem(STORAGE_KEY); } catch (_) { /* private mode */ }
    return normalizeApi(fromQuery || fromStore || window.STELENA_API || DEFAULT_API);
  }

  // ---- Connection ----------------------------------------------------------

  function socketUrl() {
    return state.api.replace(/^http/i, "ws") + STATUS_WS_PATH;
  }

  function setMode(mode, text) {
    state.mode = mode;
    el.conn.className = "pill pill--" + mode;
    el["conn-text"].textContent = text || {
      live: "Live",
      polling: "Polling",
      connecting: "Connecting…",
      offline: "Offline",
    }[mode] || mode;
  }

  function connect() {
    stopPolling();
    if (state.socket) {
      try { state.socket.close(); } catch (_) { /* ignore */ }
      state.socket = null;
    }
    setMode("connecting");
    var socket;
    try {
      socket = new WebSocket(socketUrl());
    } catch (err) {
      console.warn("[status-page] Could not open the status stream:", err);
      onSocketDown();
      return;
    }
    state.socket = socket;

    socket.onopen = function () {
      state.retries = 0;
      setMode("live");
    };
    socket.onmessage = function (event) {
      var frame;
      try {
        frame = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      handleFrame(frame);
    };
    socket.onclose = function () {
      if (state.socket === socket) state.socket = null;
      onSocketDown();
    };
    socket.onerror = function () { /* close follows */ };
  }

  function onSocketDown() {
    if (state.stopped) return;
    state.retries += 1;
    if (state.retries > WS_MAX_RETRIES) {
      // The socket is not coming back on its own; fall back to plain polling so
      // the page is still live-ish, and keep retrying the socket occasionally.
      startPolling();
      return;
    }
    var delay = Math.min(15000, 500 * Math.pow(2, state.retries - 1));
    setMode("connecting", "Reconnecting…");
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(connect, delay);
  }

  // ---- Polling fallback ----------------------------------------------------

  function startPolling() {
    setMode("polling");
    if (state.pollTimer) return;
    pollOnce();
    state.pollTimer = setInterval(pollOnce, POLL_MS);
    // Keep trying the cheaper push channel in the background.
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(function () {
      state.retries = Math.max(0, WS_MAX_RETRIES - 2);
      connect();
    }, 30000);
  }

  function stopPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function pollOnce() {
    fetch(state.api + "/status", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (snapshot) {
        handleFrame({ type: "snapshot", sentAt: new Date().toISOString(), data: snapshot });
      })
      .catch(function (err) {
        console.warn("[status-page] Status request failed:", err);
        if (!state.snapshot) setMode("offline");
      });
  }

  // ---- Frames --------------------------------------------------------------

  function handleFrame(frame) {
    if (!frame || typeof frame !== "object") return;
    if (frame.sentAt) {
      var serverNow = Date.parse(frame.sentAt);
      if (!isNaN(serverNow)) state.offset = serverNow - Date.now();
    }
    if (frame.type === "starting") {
      setMode(state.mode === "polling" ? "polling" : "live");
      return;
    }
    if (frame.type !== "snapshot" && frame.type !== "tick") return;
    state.snapshot = frame.data || null;
    if (state.mode === "connecting" || state.mode === "offline") {
      setMode(state.pollTimer ? "polling" : "live");
    }
    render();
  }

  // ---- Formatting ----------------------------------------------------------

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function formatMs(ms) {
    if (typeof ms !== "number" || !isFinite(ms)) return "—";
    return ms >= 1000 ? (ms / 1000).toFixed(1) + "s" : Math.round(ms) + "ms";
  }

  function formatAgo(iso) {
    var then = Date.parse(iso);
    if (isNaN(then)) return "—";
    var seconds = Math.max(0, Math.round((Date.now() + state.offset - then) / 1000));
    if (seconds < 60) return seconds + "s ago";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    return Math.floor(minutes / 60) + "h ago";
  }

  function formatInterval(seconds) {
    if (typeof seconds !== "number") return "—";
    if (seconds < 60) return seconds + "s";
    return Math.round(seconds / 60) + "m";
  }

  function levelClass(level) {
    return level === "operational" || level === "partial" || level === "major" ? level : "unknown";
  }

  // ---- Countdown -----------------------------------------------------------

  function remainingSeconds() {
    var snap = state.snapshot;
    if (!snap) return null;
    if (!snap.nextCheckAt) return null; // a pass is in flight
    var next = Date.parse(snap.nextCheckAt);
    if (isNaN(next)) return typeof snap.secondsUntilNextCheck === "number" ? snap.secondsUntilNextCheck : null;
    return Math.max(0, (next - (Date.now() + state.offset)) / 1000);
  }

  function renderCountdown() {
    var seconds = remainingSeconds();
    if (seconds === null) {
      el.countdown.textContent = "—";
      el["countdown-bar"].style.width = "0%";
      el["n-checked"].textContent = formatAgo(state.snapshot && state.snapshot.updatedAt);
      return;
    }
    el.countdown.textContent = String(Math.ceil(seconds));
    var interval = state.snapshot.checkSeconds || 60;
    var pct = Math.max(0, Math.min(100, (seconds / interval) * 100));
    el["countdown-bar"].style.width = pct.toFixed(1) + "%";
  }

  // ---- Rendering -----------------------------------------------------------

  function render() {
    var snap = state.snapshot;
    if (!snap) {
      el.hero.dataset.level = "unknown";
      return;
    }

    var level = levelClass(snap.level);
    el.hero.dataset.level = level;
    el["hero-label"].textContent = snap.label || snap.level;
    el["hero-note"].textContent = snap.note || "";

    var sim = snap.simulation;
    if (sim) {
      el["sim-banner"].hidden = false;
      el["sim-text"].textContent =
        (sim.label || sim.level) + " for another " + (sim.secondsLeft != null ? sim.secondsLeft + "s" : "while");
    } else {
      el["sim-banner"].hidden = true;
    }

    var totals = snap.totals || { up: 0, slow: 0, down: 0, total: 0 };
    el["n-up"].textContent = totals.up;
    el["n-slow"].textContent = totals.slow;
    el["n-down"].textContent = totals.down;
    el["n-total"].textContent = totals.total;
    el["n-checked"].textContent = formatAgo(snap.updatedAt);

    el["foot-source"].textContent = snap.sources ? "targets from " + snap.sources : "no target list";
    el["foot-updated"].textContent = formatAgo(snap.updatedAt);
    el["foot-interval"].textContent = formatInterval(snap.checkSeconds);

    var groups = groupTargets(snap.targets || []);
    var names = groups.map(function (g) { return g.name; });
    // A type can vanish between passes; fall back to showing everything.
    if (state.filter !== "all" && names.indexOf(state.filter) === -1) state.filter = "all";
    renderFilters(groups);
    var visible = state.filter === "all" ? groups : groups.filter(function (g) {
      return g.name === state.filter;
    });
    el.groups.innerHTML = renderGroups(visible);
    renderCountdown();
  }

  function groupTargets(targets) {
    var order = [];
    var byGroup = new Map();
    targets.forEach(function (target) {
      var name = target.group || "Other";
      if (!byGroup.has(name)) {
        byGroup.set(name, []);
        order.push(name);
      }
      byGroup.get(name).push(target);
    });
    return order.map(function (name) {
      return { name: name, list: byGroup.get(name) };
    });
  }

  function renderFilters(groups) {
    if (!groups.length) {
      el.filters.hidden = true;
      el.filters.innerHTML = "";
      return;
    }
    el.filters.hidden = false;
    var total = groups.reduce(function (n, g) { return n + g.list.length; }, 0);
    var chips = [{ name: "all", label: "All types", count: total }].concat(
      groups.map(function (g) { return { name: g.name, label: g.name, count: g.list.length }; })
    );
    el.filters.innerHTML = chips.map(function (chip) {
      var on = state.filter === chip.name;
      return '<button type="button" class="chip' + (on ? " chip--on" : "") +
        '" data-filter="' + escapeHtml(chip.name) + '" aria-pressed="' + on + '">' +
        escapeHtml(chip.label) + '<span class="chip__n">' + chip.count + "</span></button>";
    }).join("");
  }

  function renderGroups(groups) {
    return groups.map(function (group) {
      var list = group.list;
      var failing = list.filter(function (t) { return t.status !== "up"; }).length;
      var head = list.length + " checks";
      if (failing > 0) head = (list.length - failing) + "/" + list.length + " up";
      var rows = list.map(renderTarget).join("");
      return '<section class="group"><h3><span>' + escapeHtml(group.name) + "</span><em>" +
        escapeHtml(head) + "</em></h3><ul>" + rows + "</ul></section>";
    }).join("");
  }

  function renderTarget(target) {
    var status = target.status === "up" || target.status === "slow" || target.status === "down" ? target.status : "down";
    var detail = status === "down"
      ? (target.error || "unreachable")
      : formatMs(target.responseMs) + (status === "slow" ? " · slow" : "");
    var uptime = typeof target.uptimePercent === "number"
      ? '<span class="target__uptime" title="of ' + target.checks + ' passes">' + target.uptimePercent.toFixed(2) + "%</span>"
      : '<span class="target__uptime">—</span>';
    var http = target.httpStatus != null ? '<span class="target__http">' + target.httpStatus + "</span>" : "";
    return '<li class="target target--' + status + '">' +
      '<span class="target__dot" aria-hidden="true"></span>' +
      '<span class="target__name">' + escapeHtml(target.name) + "</span>" +
      http +
      '<span class="target__detail">' + escapeHtml(detail) + "</span>" +
      uptime +
      "</li>";
  }

  // ---- Filters -------------------------------------------------------------

  el.filters.addEventListener("click", function (event) {
    var button = event.target && event.target.closest ? event.target.closest("button[data-filter]") : null;
    if (!button) return;
    state.filter = button.getAttribute("data-filter");
    render();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !state.socket && !state.pollTimer) {
      state.retries = 0;
      connect();
    }
  });

  // ---- Boot ----------------------------------------------------------------

  state.tickTimer = setInterval(function () {
    renderCountdown();
    if (state.snapshot) {
      el["n-checked"].textContent = formatAgo(state.snapshot.updatedAt);
      el["foot-updated"].textContent = formatAgo(state.snapshot.updatedAt);
    }
  }, TICK_MS);
  connect();
})();
