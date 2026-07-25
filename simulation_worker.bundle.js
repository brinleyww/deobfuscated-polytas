(() => {
    "use strict";
    const M = {
        Init: 0,
        Verify: 1,
        TestDeterminism: 2,
        CreateCar: 3,
        DeleteCar: 4,
        StartCar: 5,
        ControlCar: 6,
        PauseCar: 7,
        VerifyResult: 8,
        DeterminismResult: 9,
        UpdateResult: 10
    };
    let initMessage = null;
    let workers = [];
    let queued = [];
    let roundRobin = 0;
    const carOwners = new Map();
    const verifyOwners = new Map();

    function clampInt(value, min, max, fallback) {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
    }

    function desiredThreadCount(message) {
        const hardware = clampInt(typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0, 1, 64, 4);
        const automatic = hardware > 2 ? hardware - 1 : hardware;
        return clampInt(message && message.polyTasThreads, 1, 16, Math.max(1, Math.min(8, automatic)));
    }

    function forwardToParent(message) {
        if (message && message.messageType === M.UpdateResult && Array.isArray(message.carStateBuffers)) {
            const transfers = message.carStateBuffers.filter(buffer => buffer instanceof ArrayBuffer);
            postMessage(message, transfers);
        } else postMessage(message);
    }

    function makeWorker(index) {
        const worker = new Worker("simulation_worker_thread.bundle.js");
        const state = {
            index,
            worker,
            cars: new Set(),
            verifyCount: 0,
            failed: false
        };
        worker.onmessage = event => {
            const message = event.data;
            if (message && message.messageType === M.VerifyResult) {
                const owner = verifyOwners.get(message.carId);
                if (owner === state) {
                    verifyOwners.delete(message.carId);
                    state.verifyCount = Math.max(0, state.verifyCount - 1)
                }
            }
            forwardToParent(message);
        };
        worker.onerror = event => {
            state.failed = true;
            console.error("[PolyTrack TAS] Simulation thread " + (index + 1) + " failed", event && event.message || event);
        };
        worker.onmessageerror = event => console.error("[PolyTrack TAS] Simulation thread " + (index + 1) + " message error", event);
        if (initMessage) worker.postMessage(initMessage);
        return state;
    }

    function stopPool() {
        for (const state of workers) try {
            state.worker.terminate()
        } catch {}
        workers = [];
        carOwners.clear();
        verifyOwners.clear();
        roundRobin = 0;
    }

    function startPool(message) {
        stopPool();
        initMessage = message;
        const count = desiredThreadCount(message);
        for (let i = 0; i < count; i++) workers.push(makeWorker(i));
        console.info("[PolyTrack TAS] Non-realtime simulation pool started with " + count + " thread" + (count === 1 ? "" : "s"));
    }

    function loadOf(state) {
        return state.failed ? Number.MAX_SAFE_INTEGER : state.cars.size + state.verifyCount
    }

    function chooseWorker() {
        if (!workers.length) return null;
        let minimum = Number.MAX_SAFE_INTEGER,
            candidates = [];
        for (const state of workers) {
            const load = loadOf(state);
            if (load < minimum) {
                minimum = load;
                candidates = [state]
            } else if (load === minimum) candidates.push(state)
        }
        if (!candidates.length) candidates = workers.filter(state => !state.failed);
        if (!candidates.length) return null;
        const chosen = candidates[roundRobin % candidates.length];
        roundRobin = (roundRobin + 1) >>> 0;
        return chosen;
    }

    function send(state, message) {
        if (state && !state.failed) state.worker.postMessage(message)
    }

    function route(message) {
        if (!message || typeof message !== "object") return;
        switch (message.messageType) {
            case M.Init:
                startPool(message);
                if (queued.length) {
                    const pending = queued;
                    queued = [];
                    for (const item of pending) route(item)
                }
                return;
            case M.CreateCar: {
                const state = chooseWorker();
                if (!state) {
                    queued.push(message);
                    return
                }
                carOwners.set(message.carId, state);
                state.cars.add(message.carId);
                send(state, message);
                return;
            }
            case M.DeleteCar: {
                const state = carOwners.get(message.carId);
                if (state) {
                    send(state, message);
                    state.cars.delete(message.carId)
                }
                carOwners.delete(message.carId);
                return;
            }
            case M.StartCar:
            case M.ControlCar:
            case M.PauseCar: {
                const state = carOwners.get(message.carId);
                if (state) send(state, message);
                return;
            }
            case M.Verify: {
                const state = chooseWorker();
                if (!state) {
                    queued.push(message);
                    return
                }
                verifyOwners.set(message.carId, state);
                state.verifyCount++;
                send(state, message);
                return;
            }
            case M.TestDeterminism: {
                const state = workers.find(item => !item.failed);
                if (state) send(state, message);
                else queued.push(message);
                return;
            }
            default: {
                const state = workers.find(item => !item.failed);
                if (state) send(state, message);
                else queued.push(message);
            }
        }
    }
    onmessage = event => route(event.data);
})();