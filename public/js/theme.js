/* ==========================================================================
   SFXDarei — theme.js
   Light/dark theme controller. Shared by every view.

   The initial theme is applied by a tiny inline snippet in each document's
   <head> (before first paint) so there is no flash of the wrong theme; this
   file only handles toggling and reacting to OS changes.
   ========================================================================== */
(function () {
    "use strict";

    var STORAGE_KEY = "sfxdarei-theme";
    var root = document.documentElement;
    var media = window.matchMedia("(prefers-color-scheme: light)");

    function readStored() {
        try {
            var value = window.localStorage.getItem(STORAGE_KEY);
            return value === "light" || value === "dark" ? value : null;
        } catch (error) {
            return null;
        }
    }

    function systemTheme() {
        return media.matches ? "light" : "dark";
    }

    function current() {
        return root.getAttribute("data-theme") === "light" ? "light" : "dark";
    }

    function apply(theme) {
        root.setAttribute("data-theme", theme);
        root.style.colorScheme = theme;

        document.querySelectorAll("[data-theme-toggle]").forEach(function (button) {
            var isLight = theme === "light";
            button.setAttribute("aria-pressed", String(isLight));
            button.setAttribute("aria-label", isLight ? "Switch to dark theme" : "Switch to light theme");
            button.setAttribute("title", isLight ? "Switch to dark theme" : "Switch to light theme");

            var icon = button.querySelector("[data-theme-icon]");
            if (icon) icon.textContent = isLight ? "☾" : "☀";
        });
    }

    function set(theme) {
        try {
            window.localStorage.setItem(STORAGE_KEY, theme);
        } catch (error) {
            /* Private mode: fall back to a session-only theme. */
        }
        apply(theme);
    }

    // Apply immediately, in case the inline snippet was blocked.
    apply(readStored() || current());

    // Delegate clicks so the button works regardless of when it is rendered.
    document.addEventListener("click", function (event) {
        var trigger = event.target.closest("[data-theme-toggle]");
        if (!trigger) return;
        event.preventDefault();
        set(current() === "light" ? "dark" : "light");
    });

    // Follow the OS only while the user has not made an explicit choice.
    var onSystemChange = function () {
        if (!readStored()) apply(systemTheme());
    };
    if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onSystemChange);
    } else if (typeof media.addListener === "function") {
        media.addListener(onSystemChange);
    }
})();
