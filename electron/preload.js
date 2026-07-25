const {
    contextBridge,
    ipcRenderer
} = require("electron");
contextBridge.exposeInMainWorld("electron", {
    quit: () => ipcRenderer.send("quit"),
    addFullscreenChangeListener: e => ipcRenderer.on("fullscreen-change", (() => e())),
    isFullscreen: () => ipcRenderer.sendSync("is-fullscreen"),
    setFullscreen: e => ipcRenderer.send("set-fullscreen", e),
    getArgv: () => ipcRenderer.sendSync("get-argv"),
    log: e => ipcRenderer.send("log-message", e),
    openTasTool: () => ipcRenderer.send("open-tas-tool"),
    setTasRecording: e => {
        try {
            const t = "string" == typeof e ? e : e && e.serialize ? e.serialize() : "";
            ipcRenderer.send("tas-tool-set-recording", t)
        } catch {
            ipcRenderer.send("tas-tool-set-recording", "")
        }
    },
    tasToolApply: e => ipcRenderer.send("tas-tool-apply", e),
    onTasToolEncodedUpdate: e => ipcRenderer.on("tas-tool-encoded-update", ((t, ...n) => e(...n))),
    onTasToolApply: e => {
        // Remove any previously registered listeners to prevent stale Rf instances
        // from handling Apply events after they have been disposed.
        ipcRenderer.removeAllListeners("tas-tool-apply");
        ipcRenderer.on("tas-tool-apply", ((t, ...n) => e(...n)));
    },
    offTasToolApply: () => {
        ipcRenderer.removeAllListeners("tas-tool-apply");
    },
    setTasGhosts: payload => ipcRenderer.send("tas-tool-set-ghosts", payload),
    onTasToolGhostsUpdate: cb => ipcRenderer.on("tas-tool-ghosts-update", ((evt, ...args) => cb(...args))),
    tasToolSetVisibility: visibleArray => ipcRenderer.send("tas-tool-set-visibility", visibleArray),
    onTasToolSetVisibility: cb => ipcRenderer.on("tas-tool-set-visibility", ((evt, ...args) => cb(...args))),
    tasToolRequestLoad: index => ipcRenderer.send("tas-tool-request-load", index),
    onTasToolRequestLoad: cb => ipcRenderer.on("tas-tool-request-load", ((evt, ...args) => cb(...args))),
    tasToolHistoryUpdate: data => ipcRenderer.send("tas-tool-history-update", data),
    tasToolSaveToFile: text => ipcRenderer.invoke("tas-tool-save-to-file", text),
    tasToolLoadFromFile: () => ipcRenderer.invoke("tas-tool-load-from-file"),

    // Bruteforce bridge: TAS editor -> main -> game renderer, and game renderer -> main -> TAS editor.
    tasToolBruteforceRun: payload => ipcRenderer.send("tas-tool-bruteforce-run", payload),
    tasToolBruteforceCancel: payload => ipcRenderer.send("tas-tool-bruteforce-cancel", payload || {}),
    tasToolBruteforceProgress: payload => ipcRenderer.send("tas-tool-bruteforce-progress", payload || {}),
    tasToolBruteforceResult: payload => ipcRenderer.send("tas-tool-bruteforce-result", payload || {}),
    onTasToolBruteforceRun: cb => {
        ipcRenderer.removeAllListeners("tas-tool-bruteforce-run");
        ipcRenderer.on("tas-tool-bruteforce-run", ((evt, ...args) => cb(...args)));
    },
    onTasToolBruteforceCancel: cb => {
        ipcRenderer.removeAllListeners("tas-tool-bruteforce-cancel");
        ipcRenderer.on("tas-tool-bruteforce-cancel", ((evt, ...args) => cb(...args)));
    },
    onTasToolBruteforceProgress: cb => ipcRenderer.on("tas-tool-bruteforce-progress", ((evt, ...args) => cb(...args))),
    onTasToolBruteforceResult: cb => ipcRenderer.on("tas-tool-bruteforce-result", ((evt, ...args) => cb(...args))),

    // Free-camera coordinates and live TAS continuation controls.
    tasToolFreeCamCoords: payload => ipcRenderer.send("tas-tool-freecam-coords", payload || {}),
    onTasToolFreeCamCoords: cb => ipcRenderer.on("tas-tool-freecam-coords", ((evt, ...args) => cb(...args))),
    tasToolDriveStart: payload => ipcRenderer.send("tas-tool-drive-start", payload || {}),
    tasToolDriveStop: payload => ipcRenderer.send("tas-tool-drive-stop", payload || {}),
    tasToolDriveRestart: payload => ipcRenderer.send("tas-tool-drive-restart", payload || {}),
    tasToolDriveRate: payload => ipcRenderer.send("tas-tool-drive-rate", payload || {}),
    tasToolDriveStatus: payload => ipcRenderer.send("tas-tool-drive-status", payload || {}),
    onTasToolDriveStart: cb => {
        ipcRenderer.removeAllListeners("tas-tool-drive-start");
        ipcRenderer.on("tas-tool-drive-start", ((evt, ...args) => cb(...args)));
    },
    onTasToolDriveStop: cb => {
        ipcRenderer.removeAllListeners("tas-tool-drive-stop");
        ipcRenderer.on("tas-tool-drive-stop", ((evt, ...args) => cb(...args)));
    },
    onTasToolDriveRate: cb => {
        ipcRenderer.removeAllListeners("tas-tool-drive-rate");
        ipcRenderer.on("tas-tool-drive-rate", ((evt, ...args) => cb(...args)));
    },
    onTasToolDriveStatus: cb => ipcRenderer.on("tas-tool-drive-status", ((evt, ...args) => cb(...args))),
    tasToolSlowMoRate: payload => ipcRenderer.send("tas-tool-slowmo-rate", payload || {}),
    onTasToolSlowMoRate: cb => ipcRenderer.on("tas-tool-slowmo-rate", ((evt, ...args) => cb(...args)))
});

window.addEventListener('DOMContentLoaded', () => {
    const getEnableTasCode = () => {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                const raw = localStorage.getItem(k);
                if (!raw) continue;
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    continue;
                }
                if (!Array.isArray(parsed)) continue;
                for (const entry of parsed) {
                    if (!Array.isArray(entry) || entry.length !== 2) continue;
                    const action = entry[0];
                    const bindings = entry[1];
                    if (action === 'EnableTas' && Array.isArray(bindings)) {
                        const [primary, secondary] = bindings;
                        if (typeof primary === 'string' && primary) return primary;
                        if (typeof secondary === 'string' && secondary) return secondary;
                    }
                }
            }
        } catch {}
        return null;
    };

    const triggerTasKey = () => {
        try {
            const code = getEnableTasCode();
            if (!code) return;
            const evt = new KeyboardEvent('keydown', {
                code,
                bubbles: true
            });
            window.dispatchEvent(evt);
        } catch {}
    };

    document.addEventListener('click', (e) => {
        const target = e.target;
        if (target && target.id === 'enable-tas-button') {
            triggerTasKey();
        }
    }, true);
});