const {
    app,
    BrowserWindow,
    session,
    shell,
    ipcMain,
    dialog
} = require("electron"), path = require("path"), zlib = require("zlib"), fs = require("fs");
let browserWindow = null,
    tasWindow = null,
    lastTasRecording = null,
    lastTasGhosts = null,
    tasHistory = null,
    tasHistoryIndex = -1,
    bruteforceRuns = new Map,
    tasDriveAckTimer = null,
    tasDriveSessionId = 0,
    lastTasDrivePayload = null;
const singleInstanceLockSucessful = app.requestSingleInstanceLock();

function decodeTasRecording(e) {
    try {
        if ("string" != typeof e || !e) return null;
        let t = e.replace(/-/g, "+").replace(/_/g, "/");
        const n = t.length % 4;
        n && (t += "=".repeat(4 - n));
        const i = Buffer.from(t, "base64"),
            r = zlib.inflateSync(i);
        if (!r) return null;
        const a = new Uint8Array(r);
        let s = 0;

        function o() {
            if (s + 3 > a.length) return null;
            const e = a[s] | a[s + 1] << 8 | a[s + 2] << 16;
            s += 3;
            const t = new Array(e);
            let n = 0;
            for (let i = 0; i < e; i++) {
                if (s + 3 > a.length) return null;
                const e = a[s] | a[s + 1] << 8 | a[s + 2] << 16;
                s += 3, n = 0 === i ? e : n + e, t[i] = n
            }
            return t
        }
        const l = o();
        if (null == l) return null;
        const c = o();
        if (null == c) return null;
        const d = o();
        if (null == d) return null;
        const u = o();
        if (null == u) return null;
        const f = o();
        return null == f ? null : {
            up: l,
            right: c,
            down: d,
            left: u,
            reset: f
        }
    } catch {
        return null
    }
}

function formatTasHuman(e) {
    try {
        if (!e) return "";
        const r = ["up", "left", "down", "right", "reset"],
            t = {
                up: "w",
                left: "a",
                down: "s",
                right: "d",
                reset: "r"
            },
            n = {},
            i = new Set;
        for (const o of r) {
            const a = e[o] || [],
                s = new Set(a);
            n[o] = s;
            for (let l = 0; l < a.length; l++) i.add(a[l])
        }
        const c = Array.from(i).sort(((e, r) => e - r)),
            u = {
                up: !1,
                left: !1,
                down: !1,
                right: !1,
                reset: !1
            },
            d = [];
        for (let f = 0; f < c.length; f++) {
            const h = c[f];
            for (const p of r) n[p].has(h) && (u[p] = !u[p]);
            let g = "";
            for (const v of r) u[v] && (g += t[v]);
            d.push(h + "," + g)
        }
        return d.join("\n")
    } catch {
        return ""
    }
}

function parseTasHuman(e) {
    try {
        const t = e.split("\n").map((line => {
                const i = line.indexOf("#");
                return i >= 0 ? line.slice(0, i) : line;
            })).filter((e => "" !== e.trim())),
            n = [];
        for (const i of t) {
            const e = i.split(",");
            if (2 !== e.length) continue;
            const r = parseInt(e[0], 10),
                a = e[1].trim();
            if (isNaN(r)) continue;
            n.push({
                frame: r,
                keys: a
            })
        }
        const i = {
                w: "up",
                a: "left",
                s: "down",
                d: "right",
                r: "reset"
            },
            r = {
                up: [],
                right: [],
                down: [],
                left: [],
                reset: []
            },
            a = {
                up: !1,
                left: !1,
                down: !1,
                right: !1,
                reset: !1
            };
        let s = -1;
        for (const o of n) {
            if (o.frame <= s) continue;
            const l = {
                up: !1,
                left: !1,
                down: !1,
                right: !1,
                reset: !1
            };
            for (const c of o.keys) {
                const e = i[c];
                e && (l[e] = !0)
            }
            for (const d in a) a[d] !== l[d] && r[d].push(o.frame);
            Object.assign(a, l), s = o.frame
        }
        return r
    } catch (e) {
        return console.error("Failed to parse human-readable TAS input:", e), null
    }
}

function encodeTasRecording(e) {
    try {
        if (!e) return null;
        const t = [],
            n = ["up", "right", "down", "left", "reset"];
        for (const i of n) {
            const n = e[i] || [],
                r = Buffer.alloc(3 + 3 * n.length);
            r.writeUIntLE(n.length, 0, 3);
            let a = 0;
            for (let s = 0; s < n.length; s++) {
                const e = n[s] - a;
                r.writeUIntLE(e, 3 + 3 * s, 3), a = n[s]
            }
            t.push(r)
        }
        const i = Buffer.concat(t),
            r = zlib.deflateSync(i);
        let a = r.toString("base64");
        return a = a.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, ""), a
    } catch (e) {
        return console.error("Failed to encode TAS recording:", e), null
    }
}

function ensureTasWindow() {
    if (null == tasWindow || tasWindow.isDestroyed()) {
        tasWindow = new BrowserWindow({
            width: 1280,
            height: 720,
            resizable: !0,
            autoHideMenuBar: !0,
            title: "TAS Tool",
            webPreferences: {
                devTools: !1,
                backgroundThrottling: !1,
                preload: path.join(__dirname, "preload.js")
            }
        }), tasWindow.on("closed", (() => {
            tasWindow = null
        }))
    }
    tasWindow.setTitle("TAS Tool"), tasWindow.show(), tasWindow.focus();
    tasWindow.loadFile(path.join(__dirname, "tas-tool.html"));
    // After page loads, inject current recording and ghost list
    try {
        tasWindow.webContents.once("did-finish-load", () => {
            try {
                tasWindow.webContents.executeJavaScript(
                    'window.__tasHistory=' + JSON.stringify(tasHistory) + ';' +
                    'window.__tasHistoryIndex=' + JSON.stringify(tasHistoryIndex) + ';'
                ).catch(() => {});
            } catch {}
            if (lastTasRecording) {
                try {
                    const dec = decodeTasRecording(lastTasRecording);
                    const human = dec ? formatTasHuman(dec) : "";
                    tasWindow.webContents.executeJavaScript(
                        'window.__tasEncoded=' + JSON.stringify(lastTasRecording) + ';' +
                        'window.__tasDecoded=' + JSON.stringify(human) + ';' +
                        'try{document.getElementById("encoded").value=window.__tasEncoded||"";}catch{}' +
                        'try{var d=document.getElementById("decoded");if(d){d.value=window.__tasDecoded||"";}}catch{}'
                    ).catch(() => {});
                } catch {}
            }
            if (lastTasGhosts) {
                try {
                    tasWindow.webContents.executeJavaScript(
                        'window.__tasGhosts=' + JSON.stringify(lastTasGhosts) + ';' +
                        'try{if(window.renderGhosts) renderGhosts(window.__tasGhosts);}catch{}'
                    ).catch(() => {});
                } catch {}
            }
            // Inject Undo/Redo UI and history manager
            try {
                tasWindow.webContents.executeJavaScript(`
(function(){
  try {
    var $ = function(id){ return document.getElementById(id); };
    var decodedEl = $("decoded");
    if (!decodedEl) return;
    var copyBtn = $("copy");
    var container = copyBtn ? copyBtn.parentElement : null;
    if (container && !$("undo") && !$("redo")) {
      var undoBtn = document.createElement("button");
      undoBtn.id = "undo";
      undoBtn.textContent = "Undo";
      container.insertBefore(undoBtn, copyBtn);
      var redoBtn = document.createElement("button");
      redoBtn.id = "redo";
      redoBtn.textContent = "Redo";
      container.insertBefore(redoBtn, copyBtn);
    }
    var undoBtn = $("undo");
    var redoBtn = $("redo");
    var history = Array.isArray(window.__tasHistory) ? window.__tasHistory : [];
    var historyIndex = typeof window.__tasHistoryIndex === "number" ? window.__tasHistoryIndex : -1;
    var historyApplying = false;
    var lastInputTime = 0;
    var HISTORY_MAX = 200;
    function sendHistoryUpdate() {
      try {
        if (window.electron && typeof window.electron.tasToolHistoryUpdate === "function") {
          window.electron.tasToolHistoryUpdate({ history: history, historyIndex: historyIndex });
        }
      } catch(e) {}
    }
    function updateButtons() {
      try { if (undoBtn) undoBtn.disabled = !(historyIndex > 0); } catch(e) {}
      try { if (redoBtn) redoBtn.disabled = !(historyIndex + 1 < history.length); } catch(e) {}
    }
    function getState() {
      return {
        value: decodedEl.value,
        selStart: decodedEl.selectionStart,
        selEnd: decodedEl.selectionEnd,
        scrollTop: decodedEl.scrollTop
      };
    }
    function pushState(state) {
      if (historyApplying) return;
      if (historyIndex < history.length - 1) {
        history = history.slice(0, historyIndex + 1);
      }
      var cur = history[historyIndex];
      if (cur && cur.value === state.value && cur.selStart === state.selStart && cur.selEnd === state.selEnd) {
        updateButtons();
        return;
      }
      history.push(state);
      if (history.length > HISTORY_MAX) {
        history.shift();
        historyIndex--;
      }
      historyIndex = history.length - 1;
      updateButtons();
      sendHistoryUpdate();
    }
    function applyState(state) {
      historyApplying = true;
      try {
        if (typeof setHuman === "function") {
          setHuman(state.value);
        } else {
          decodedEl.value = state.value;
        }
        decodedEl.focus();
        try { decodedEl.setSelectionRange(state.selStart, state.selEnd); } catch(e) {}
        try {
          var ta = decodedEl;
          var start = state.selStart;
          var textBefore = ta.value.substring(0, start);
          var lineNumber = textBefore.split('\\n').length;
          var style = window.getComputedStyle(ta);
          var lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) * 1.2) || 15;
          ta.scrollTop = (lineNumber - 1) * lineHeight - (ta.clientHeight / 2) + (lineHeight / 2);
        } catch(e) {
          try { decodedEl.scrollTop = state.scrollTop; } catch(e) {}
        }
      } finally {
        historyApplying = false;
        updateButtons();
      }
    }
    function undo() {
      if (historyIndex > 0) {
        var stateBeingUndone = history[historyIndex];
        historyIndex--;
        var stateToRestore = history[historyIndex];
        applyState({ value: stateToRestore.value, selStart: stateBeingUndone.selStart, selEnd: stateBeingUndone.selEnd, scrollTop: stateBeingUndone.scrollTop });
        sendHistoryUpdate();
      }
      updateButtons();
    }
    function redo() {
      if (historyIndex + 1 < history.length) {
        historyIndex++;
        applyState(history[historyIndex]);
        sendHistoryUpdate();
      }
      updateButtons();
    }
    try {
      var __origSetHuman = typeof setHuman === "function" ? setHuman : null;
      if (__origSetHuman) {
        setHuman = function(v) {
          var oldValue = decodedEl.value;
          __origSetHuman(v);
          if (!historyApplying) {
            var state = getState();
            var start = 0;
            var max = Math.min(oldValue.length, state.value.length);
            while (start < max && oldValue[start] === state.value[start]) start++;
            state.selStart = start;
            state.selEnd = start;
            pushState(state);
          }
        };
      }
    } catch(e) {}
    if (history.length === 0) pushState(getState());
    decodedEl.addEventListener("input", function() {
      if (historyApplying) return;
      var now = Date.now();
      if (history.length && now - lastInputTime < 300) {
        history[historyIndex] = getState();
        updateButtons();
        sendHistoryUpdate();
      } else {
        pushState(getState());
      }
      lastInputTime = now;
    });
    if (undoBtn) undoBtn.onclick = function(){ undo(); };
    if (redoBtn) redoBtn.onclick = function(){ redo(); };
    window.addEventListener("keydown", function(e) {
      var isMod = e.ctrlKey || e.metaKey;
      if (!isMod || e.altKey) return;
      if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        redo();
      }
    }, true);
    updateButtons();
  } catch(e) {}
})();
`).catch(() => {});
            } catch {}
        });
    } catch {}
}

singleInstanceLockSucessful ? app.on("second-instance", (() => {
        null != browserWindow && (browserWindow.isMinimized() && browserWindow.restore(), browserWindow.focus())
    })) : app.quit(),
    app.on("web-contents-created", ((e, n) => {
        n.setWindowOpenHandler((({
            url: e
        }) => (
            "https://www.kodub.com/" != e && "https://opengameart.org/content/sci-fi-theme-1" != e &&
            "https://www.kodub.com/terms/polytrack" != e && "https://www.kodub.com/privacy/polytrack" != e &&
            "https://www.kodub.com/discord/polytrack" != e || setImmediate((() => {
                shell.openExternal(e)
            })), {
                action: "deny"
            }
        ))), n.on("will-navigate", ((e, n) => {
            e.preventDefault()
        }))
    })),
    ipcMain.on("get-argv", (e => {
        e.returnValue = process.argv
    })),
    ipcMain.on("log-message", ((e, n) => {
        console.log(n)
    })),
    ipcMain.on("quit", (() => {
        app.quit()
    })),
    ipcMain.on("open-tas-tool", (() => {
        ensureTasWindow()
    })),
    ipcMain.on("tas-tool-set-recording", ((e, recording) => {
        try {
            lastTasRecording = recording || "";
            if (tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents) {
                const dec = decodeTasRecording(lastTasRecording);
                const human = dec ? formatTasHuman(dec) : "";
                tasWindow.webContents.executeJavaScript(
                    'window.__tasEncoded=' + JSON.stringify(lastTasRecording) + ';' +
                    'window.__tasDecoded=' + JSON.stringify(human) + ';' +
                    'try{document.getElementById("encoded").value=window.__tasEncoded||"";}catch{}' +
                    'try{var d=document.getElementById("decoded");if(d){d.value=window.__tasDecoded||"";}}catch{}'
                ).catch(() => {});
            }
        } catch {}
    })),
    ipcMain.on("tas-tool-apply", ((e, rawText) => {
        try {
            if (browserWindow && !browserWindow.isDestroyed()) {
                const parsed = parseTasHuman(rawText);
                const encoded = parsed ? encodeTasRecording(parsed) : null;
                if (encoded) {
                    lastTasRecording = encoded;
                    if (tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents) {
                        tasWindow.webContents.send("tas-tool-encoded-update", encoded);
                    }
                    browserWindow.webContents && browserWindow.webContents.send("tas-tool-apply", encoded);
                }
            }
        } catch {}
    })),
    ipcMain.handle("tas-tool-save-to-file", (async (e, text) => {
        try {
            const parent = tasWindow && !tasWindow.isDestroyed() ? tasWindow : BrowserWindow.getFocusedWindow();
            const {
                canceled,
                filePath
            } = await dialog.showSaveDialog(parent, {
                title: "Save TAS Script",
                defaultPath: "tas.tas",
                filters: [{
                    name: "TAS Scripts",
                    extensions: ["tas", "txt"]
                }, {
                    name: "All Files",
                    extensions: ["*"]
                }]
            });
            if (canceled || !filePath) return {
                canceled: true
            };
            await fs.promises.writeFile(filePath, text, "utf8");
            return {
                canceled: false,
                filePath
            };
        } catch (err) {
            return {
                canceled: true,
                error: String(err && err.message || err)
            };
        }
    })),
    ipcMain.handle("tas-tool-load-from-file", (async (e) => {
        try {
            const parent = tasWindow && !tasWindow.isDestroyed() ? tasWindow : BrowserWindow.getFocusedWindow();
            const {
                canceled,
                filePaths
            } = await dialog.showOpenDialog(parent, {
                title: "Load TAS Script",
                filters: [{
                    name: "TAS Scripts",
                    extensions: ["tas", "txt"]
                }, {
                    name: "All Files",
                    extensions: ["*"]
                }],
                properties: ["openFile"]
            });
            if (canceled || !filePaths || !filePaths[0]) return {
                canceled: true
            };
            const content = await fs.promises.readFile(filePaths[0], "utf8");
            return {
                canceled: false,
                filePath: filePaths[0],
                content
            };
        } catch (err) {
            return {
                canceled: true,
                error: String(err && err.message || err)
            };
        }
    })),
    ipcMain.on("tas-tool-history-update", ((e, data) => {
        if (data && Array.isArray(data.history)) {
            tasHistory = data.history;
            tasHistoryIndex = "number" == typeof data.historyIndex ? data.historyIndex : -1;
        }
    })),
    // Free-camera coordinate relay: game renderer -> TAS editor.
    ipcMain.on("tas-tool-freecam-coords", ((e, payload) => {
        try {
            tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-freecam-coords", payload || {});
        } catch {}
    })),
    // Start a live continuation from the current TAS end.
    ipcMain.on("tas-tool-drive-start", ((e, payload) => {
        try {
            if (!browserWindow || browserWindow.isDestroyed() || !browserWindow.webContents) {
                tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                    status: "error",
                    stage: "dispatch",
                    message: "Game window is not available."
                });
                return;
            }
            payload = payload && typeof payload === "object" ? payload : {};
            const text = typeof payload.text === "string" ? payload.text : "";
            const parsed = parseTasHuman(text);
            const encoded = parsed ? encodeTasRecording(parsed) : null;
            if (!encoded) {
                tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                    status: "error",
                    stage: "encode",
                    message: "The current TAS could not be encoded."
                });
                return;
            }

            const entries = [];
            for (const line of text.split("\n")) {
                const clean = line.split("#")[0].trim();
                if (!clean) continue;
                const comma = clean.indexOf(",");
                if (comma < 0) continue;
                const frame = parseInt(clean.slice(0, comma), 10);
                if (!Number.isFinite(frame)) continue;
                const keySet = new Set(clean.slice(comma + 1).trim().toLowerCase().split(""));
                const keys = ["w", "a", "s", "d", "r"].filter(ch => keySet.has(ch)).join("");
                entries.push({
                    frame,
                    keys
                });
            }
            entries.sort((a, b) => a.frame - b.frame);
            const lastFrame = entries.reduce((m, item) => Math.max(m, item.frame), 0);
            const takeoverFrame = Number.isFinite(Number(payload.takeoverFrame)) ?
                Math.max(0, Math.floor(Number(payload.takeoverFrame))) :
                lastFrame;
            let initialKeys = "";
            for (const item of entries) {
                if (item.frame <= takeoverFrame) initialKeys = item.keys;
                else break;
            }

            const sessionId = ++tasDriveSessionId;
            const outgoing = Object.assign({}, payload, {
                text,
                encoded,
                sessionId,
                takeoverFrame,
                initialKeys: typeof payload.initialKeys === "string" ? payload.initialKeys : initialKeys
            });
            lastTasDrivePayload = outgoing;

            if (tasDriveAckTimer) {
                clearTimeout(tasDriveAckTimer);
                tasDriveAckTimer = null;
            }
            tasDriveAckTimer = setTimeout(() => {
                if (sessionId !== tasDriveSessionId) return;
                try {
                    tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                        status: "error",
                        stage: "renderer-ack",
                        message: "The replay screen did not acknowledge drive mode. Open the TAS tool from an active replay screen and try again."
                    });
                } catch {}
            }, 5000);

            browserWindow.webContents.send("tas-tool-drive-start", outgoing);
            tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                status: "starting",
                stage: "dispatch",
                sessionId,
                takeoverFrame,
                initialKeys: outgoing.initialKeys
            });

            setTimeout(() => {
                try {
                    if (!browserWindow || browserWindow.isDestroyed()) return;
                    if (browserWindow.isMinimized()) browserWindow.restore();
                    browserWindow.show();
                    browserWindow.focus();
                    browserWindow.webContents.focus();
                    try {
                        app.focus({
                            steal: true
                        });
                    } catch {}
                } catch {}
            }, 100);
        } catch (err) {
            tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                status: "error",
                stage: "dispatch",
                message: String(err && err.message || err)
            });
        }
    })),
    ipcMain.on("tas-tool-drive-stop", ((e, payload) => {
        try {
            browserWindow && !browserWindow.isDestroyed() && browserWindow.webContents && browserWindow.webContents.send("tas-tool-drive-stop", payload || {});
        } catch {}
    })),
    ipcMain.on("tas-tool-drive-restart", (() => {
        try {
            if (!lastTasDrivePayload || !browserWindow || browserWindow.isDestroyed() || !browserWindow.webContents) return;
            const sessionId = ++tasDriveSessionId;
            const outgoing = Object.assign({}, lastTasDrivePayload, {
                sessionId
            });
            lastTasDrivePayload = outgoing;
            if (tasDriveAckTimer) {
                clearTimeout(tasDriveAckTimer);
                tasDriveAckTimer = null;
            }
            tasDriveAckTimer = setTimeout(() => {
                if (sessionId !== tasDriveSessionId) return;
                try {
                    tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                        status: "error",
                        stage: "restart-ack",
                        message: "The replay screen did not acknowledge the restarted attempt."
                    });
                } catch {}
            }, 5000);
            browserWindow.webContents.send("tas-tool-drive-start", outgoing);
            tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                status: "restarting",
                stage: "restart",
                sessionId,
                takeoverFrame: outgoing.takeoverFrame
            });
            if (browserWindow.isMinimized()) browserWindow.restore();
            browserWindow.show();
            browserWindow.focus();
            browserWindow.webContents.focus();
            try {
                app.focus({
                    steal: true
                });
            } catch {}
        } catch (err) {
            try {
                tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", {
                    status: "error",
                    stage: "restart",
                    message: String(err && err.message || err)
                });
            } catch {}
        }
    })),
    ipcMain.on("tas-tool-drive-rate", ((e, payload) => {
        try {
            browserWindow && !browserWindow.isDestroyed() && browserWindow.webContents && browserWindow.webContents.send("tas-tool-drive-rate", payload || {});
        } catch {}
    })),
    ipcMain.on("tas-tool-slowmo-rate", ((e, payload) => {
        try {
            browserWindow && !browserWindow.isDestroyed() && browserWindow.webContents && browserWindow.webContents.send("tas-tool-slowmo-rate", payload || {});
        } catch {}
    })),
    ipcMain.on("tas-tool-drive-status", ((e, payload) => {
        try {
            payload = payload && typeof payload === "object" ? payload : {};
            if (payload.sessionId && Number(payload.sessionId) !== tasDriveSessionId) return;
            if (["received", "preroll", "driving", "stopped", "aborted", "error"].includes(payload.status)) {
                if (tasDriveAckTimer) {
                    clearTimeout(tasDriveAckTimer);
                    tasDriveAckTimer = null;
                }
            }
            if (typeof payload.encoded === "string" && payload.encoded) lastTasRecording = payload.encoded;
            else if (typeof payload.text === "string" && payload.text) {
                const parsed = parseTasHuman(payload.text);
                const encoded = parsed ? encodeTasRecording(parsed) : null;
                if (encoded) {
                    payload.encoded = encoded;
                    lastTasRecording = encoded;
                }
            }
            tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-drive-status", payload);
            if (["stopped", "aborted", "error"].includes(payload.status)) {
                lastTasDrivePayload = null;
                setTimeout(() => {
                    try {
                        if (tasWindow && !tasWindow.isDestroyed()) {
                            tasWindow.show();
                            tasWindow.focus();
                            tasWindow.webContents.focus();
                        }
                    } catch {}
                }, 80);
            }
        } catch {}
    })),
    ipcMain.on("tas-tool-bruteforce-run", ((e, payload) => {
        try {
            if (!browserWindow || browserWindow.isDestroyed() || !browserWindow.webContents) {
                tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-bruteforce-result", {
                    status: "error",
                    message: "Game window is not available."
                });
                return;
            }
            payload = payload && typeof payload === "object" ? payload : {};
            const rawCandidates = Array.isArray(payload.candidates) ? payload.candidates : [];
            const runId = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
            const candidates = [];
            const MAX_CANDIDATES = 5000;
            for (let i = 0; i < rawCandidates.length && candidates.length < MAX_CANDIDATES; i++) {
                const c = rawCandidates[i] || {};
                const text = "string" == typeof c.text ? c.text : "";
                const parsed = parseTasHuman(text);
                const encoded = parsed ? encodeTasRecording(parsed) : null;
                if (!encoded) continue;
                candidates.push({
                    index: "number" == typeof c.index ? c.index : i,
                    label: "string" == typeof c.label ? c.label : ("candidate " + (i + 1)),
                    inputCount: c.inputCount != null && Number.isFinite(Number(c.inputCount)) ? Math.max(0, Math.floor(Number(c.inputCount))) : null,
                    text,
                    encoded
                });
            }
            bruteforceRuns.set(runId, {
                candidates,
                created: Date.now()
            });
            for (const [id, meta] of bruteforceRuns) {
                if (!meta || Date.now() - meta.created > 30 * 60 * 1000) bruteforceRuns.delete(id);
            }
            const outgoing = Object.assign({}, payload, {
                runId,
                candidates: candidates.map(c => ({
                    index: c.index,
                    label: c.label,
                    inputCount: c.inputCount,
                    encoded: c.encoded
                }))
            });
            browserWindow.webContents.send("tas-tool-bruteforce-run", outgoing);
            tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-bruteforce-progress", {
                runId,
                status: "queued",
                done: 0,
                total: candidates.length,
                message: "Queued " + candidates.length + " candidates."
            });
        } catch (err) {
            tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-bruteforce-result", {
                status: "error",
                message: String(err && err.message || err)
            });
        }
    })),
    ipcMain.on("tas-tool-bruteforce-cancel", ((e, payload) => {
        try {
            browserWindow && !browserWindow.isDestroyed() && browserWindow.webContents && browserWindow.webContents.send("tas-tool-bruteforce-cancel", payload || {});
            tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-bruteforce-progress", Object.assign({
                status: "cancelling",
                message: "Cancelling bruteforce..."
            }, payload || {}));
        } catch {}
    })),
    ipcMain.on("tas-tool-bruteforce-progress", ((e, payload) => {
        try {
            tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-bruteforce-progress", payload || {});
        } catch {}
    })),
    ipcMain.on("tas-tool-bruteforce-result", ((e, payload) => {
        try {
            payload = payload && typeof payload === "object" ? payload : {};
            const runId = payload.runId;
            const meta = runId ? bruteforceRuns.get(runId) : null;
            if (meta && payload.best && "number" == typeof payload.best.index) {
                const cand = meta.candidates.find(c => c.index === payload.best.index);
                if (cand) {
                    payload.best.text = cand.text;
                    payload.best.encoded = cand.encoded;
                    payload.best.label = cand.label;
                    payload.best.inputCount = cand.inputCount;
                }
            }
            if (runId) bruteforceRuns.delete(runId);
            tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents && tasWindow.webContents.send("tas-tool-bruteforce-result", payload);
        } catch (err) {
            tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-bruteforce-result", {
                status: "error",
                message: String(err && err.message || err)
            });
        }
    })),
    app.on("window-all-closed", (() => {
        app.quit()
    })),
    app.whenReady().then((() => {
        browserWindow = new BrowserWindow({
                width: 1024,
                height: 800,
                minWidth: 320,
                minHeight: 200,
                fullscreen: !0,
                useContentSize: !0,
                autoHideMenuBar: !0,
                webPreferences: {
                    devTools: !1,
                    preload: path.join(__dirname, "preload.js"),
                    backgroundThrottling: !1
                }
            }),
            browserWindow.removeMenu(),
            browserWindow.webContents.on("before-input-event", ((e, n) => {
                n.isAutoRepeat || "keyDown" != n.type || ("F11" == n.code || n.alt && "Enter" == n.code) &&
                    (browserWindow.setFullScreen(!browserWindow.isFullScreen()), e.preventDefault())
            })),
            browserWindow.webContents.on("will-prevent-unload", (e => {
                e.preventDefault()
            })),
            browserWindow.on("enter-full-screen", (() => {
                browserWindow.webContents.send("fullscreen-change", !0)
            })),
            browserWindow.on("leave-full-screen", (() => {
                browserWindow.webContents.send("fullscreen-change", !1)
            })),
            ipcMain.on("is-fullscreen", ((e) => {
                e.returnValue = browserWindow.isFullScreen()
            })),
            ipcMain.on("set-fullscreen", ((e, n) => {
                browserWindow.setFullScreen(n)
            })),
            // From game renderer: update ghosts list for TAS window
            ipcMain.on("tas-tool-set-ghosts", ((e, payload) => {
                try {
                    if (payload && Array.isArray(payload.names)) {
                        if (lastTasGhosts && Array.isArray(lastTasGhosts.names) && lastTasGhosts.names.length === payload.names.length) {
                            if (Array.isArray(lastTasGhosts.visibility)) {
                                payload.visibility = payload.visibility && payload.visibility.length === lastTasGhosts.visibility.length ? payload.visibility : lastTasGhosts.visibility;
                            }
                            if (Array.isArray(lastTasGhosts.colors) && (!Array.isArray(payload.colors) || payload.colors.length !== lastTasGhosts.colors.length)) {
                                payload.colors = lastTasGhosts.colors;
                            }
                            if (Array.isArray(lastTasGhosts.secondaryColors) && (!Array.isArray(payload.secondaryColors) || payload.secondaryColors.length !== lastTasGhosts.secondaryColors.length)) {
                                payload.secondaryColors = lastTasGhosts.secondaryColors;
                            }
                        }
                        lastTasGhosts = payload;
                        if (tasWindow && !tasWindow.isDestroyed() && tasWindow.webContents) {
                            tasWindow.webContents.executeJavaScript(
                                'window.__tasGhosts=' + JSON.stringify(payload) + ';' +
                                'try{if(window.renderGhosts) renderGhosts(window.__tasGhosts);}catch{}'
                            ).catch(() => {});
                        }
                    }
                } catch {}
            })),
            // From TAS window: request to load a specific ghost's recording into the editor
            ipcMain.on("tas-tool-request-load", ((e, index) => {
                try {
                    if (browserWindow && !browserWindow.isDestroyed()) {
                        browserWindow.webContents && browserWindow.webContents.send("tas-tool-request-load", index);
                    }
                } catch {}
            })),
            // From TAS window: visibility toggles -> forward to game renderer
            ipcMain.on("tas-tool-set-visibility", ((e, visibleArray) => {
                try {
                    if (lastTasGhosts) {
                        lastTasGhosts.visibility = Array.isArray(visibleArray) ? visibleArray : null;
                        tasWindow && tasWindow.webContents && tasWindow.webContents.send("tas-tool-ghosts-update", lastTasGhosts);
                    }
                } catch {}
                browserWindow && browserWindow.webContents && browserWindow.webContents.send("tas-tool-set-visibility", visibleArray)
            })),
            session.defaultSession.webRequest.onBeforeSendHeaders({
                urls: ["<all_urls>"]
            }, ((e, n) => {
                e.requestHeaders.Origin = "https://app-polytrack-desktop.kodub.com", n({
                    requestHeaders: e.requestHeaders
                })
            })),
            browserWindow.loadFile("index.html")
    }));