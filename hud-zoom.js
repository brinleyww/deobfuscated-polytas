(function() {
    var UI_CONTAINER_ID = 'ui';
    var STORAGE_KEY = 'polyplus:hudZoom'; // stores user zoom factor only
    var MIN_USER_SCALE = 0.5;
    var MAX_USER_SCALE = 2.0;
    var STEP = 0.1;
    var baseScale = 1; // ADDED: A variable to cache the base scale.
    var lastAppliedUserScale = 1;

    function getSavedScale() {
        var value = localStorage.getItem(STORAGE_KEY);
        var parsed = value ? parseFloat(value) : NaN;
        return isNaN(parsed) ? 1 : clampUser(parsed);
    }

    function clampUser(n) {
        // IMPROVED: Round to 2 decimal places to avoid floating point errors.
        var rounded = Math.round(n * 100) / 100;
        if (rounded < MIN_USER_SCALE) return MIN_USER_SCALE;
        if (rounded > MAX_USER_SCALE) return MAX_USER_SCALE;
        return rounded;
    }

    function getUi() {
        return document.getElementById(UI_CONTAINER_ID);
    }

    // Compute the engine's base UI scale from viewport size, independent of user zoom.
    function calculateBaseScale() {
        var width = window.innerWidth || document.documentElement.clientWidth || 0;
        var height = window.innerHeight || document.documentElement.clientHeight || 0;
        var candidate = Math.min(width, 1.4375 * height) / 1150;
        var clamped = Math.max(0.01, Math.min(1, candidate));
        return !isFinite(clamped) || clamped <= 0 ? 1 : clamped;
    }

    function applyScale(userScale) {
        var ui = getUi();
        if (!ui) return;
        // REMOVED: The call to getBaseScale() on every application.
        // var baseScale = getBaseScale();

        // MODIFIED: Use the cached baseScale instead.
        var totalScale = baseScale * userScale;

        ui.style.transformOrigin = '0 0';
        ui.style.width = 'calc(100% / ' + totalScale + ')';
        ui.style.height = 'calc(100% / ' + totalScale + ')';
        ui.style.transform = 'scale(' + totalScale + ')';
        ui.style.willChange = 'transform';
        // Keep CSS variables in sync so safe-area calculations remain correct
        document.documentElement.style.setProperty('--ui-scale-factor', String(totalScale));
        localStorage.setItem(STORAGE_KEY, String(userScale));
        lastAppliedUserScale = userScale;
    }

    var currentUserScale = getSavedScale();
    // `lastAppliedUserScale` is defined at the top.

    function onReady() {
        // MODIFIED: Calculate the base scale ONCE on load and cache it.
        baseScale = calculateBaseScale();
        applyScale(currentUserScale);
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        onReady();
    } else {
        window.addEventListener('DOMContentLoaded', onReady, {
            once: true
        });
    }

    function isZoomInEvent(e) {
        return e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
    }

    function isZoomOutEvent(e) {
        return e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-';
    }

    function isResetEvent(e) {
        return e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0';
    }

    function onKeyDown(e) {
        if (!(e.ctrlKey || e.metaKey)) return;

        var next = null;
        if (isZoomInEvent(e)) next = clampUser(currentUserScale + STEP);
        else if (isZoomOutEvent(e)) next = clampUser(currentUserScale - STEP);
        else if (isResetEvent(e)) next = 1;
        else return;

        e.preventDefault();
        e.stopPropagation();

        if (next !== currentUserScale) {
            currentUserScale = next;
            applyScale(currentUserScale);
        }
    }

    window.addEventListener('keydown', onKeyDown, true);

    // Re-apply after window resizes, since the base scale may change.
    (function() {
        var scheduled = false;

        function schedule() {
            if (scheduled) return;
            scheduled = true;
            // Use two RAFs to run after the engine's own layout/scale adjustments.
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    scheduled = false;
                    // Recalculate the base scale before reapplying the user scale.
                    baseScale = calculateBaseScale();
                    applyScale(currentUserScale);
                });
            });
        }
        window.addEventListener('resize', schedule);
        window.addEventListener('orientationchange', schedule);
        // Re-apply after focus/visibility regain (e.g., Alt+Tab) so user zoom persists.
        window.addEventListener('focus', schedule);
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') schedule();
        });
        window.addEventListener('pageshow', schedule);
    })();
})();