/**
 * Icon Fix — GNOME Shell Extension
 *
 * Detects windows whose icon association is broken (no valid .desktop match)
 * and creates a corrected .desktop file in ~/.local/share/applications/ with
 * the right StartupWMClass so future launches resolve correctly.
 *
 * Compatible with GNOME Shell 45+ (ES module format).
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import Meta from 'gi://Meta';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Directory where user-level .desktop files live. */
const USER_APP_DIR = `${GLib.get_home_dir()}/.local/share/applications`;


const FEATURE_TOGGLE = {}

/** Prefix added to auto-generated .desktop files to avoid collisions. */
const FIX_PREFIX = 'iconfix-';

/**
 * Minimum heuristic score (0–100) required before we trust a candidate match.
 * Raise this value to be more conservative; lower it to be more aggressive.
 */
const MIN_MATCH_SCORE = 50;

/** How long to wait (ms) after a window is created before inspecting it.
 *  Wayland apps often set wm_class / gtk_application_id with a short delay. */
const WINDOW_INSPECT_DELAY_MS = 600;

// ─── Extension class ──────────────────────────────────────────────────────────

export default class IconFixExtension {

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    enable() {
        log('[IconFix] Extension enabled');

        /**
         * Set of wmClass values we have already processed this session so we
         * don't re-create .desktop files on every focus-change or repeated signal.
         * @type {Set<string>}
         */
        this._processed = new Set();

        /**
         * Map from MetaWindow → signal-connection-id so we can disconnect on
         * disable without leaking resources.
         * @type {Map<Meta.Window, number>}
         */
        this._pendingConnections = new Map();

        /** Connection id for the global display 'window-created' signal. */
        this._displayConnectionId = globalThis.display.connect(
            'window-created',
            (_display, win) => this._scheduleInspection(win)
        );

        // Process windows that are already open when the extension is loaded.
        this._inspectExistingWindows();
    }

    disable() {
        log('[IconFix] Extension disabled');

        if (this._displayConnectionId) {
            global.display.disconnect(this._displayConnectionId);
            this._displayConnectionId = null;
        }

        // Disconnect any pending per-window signals.
        for (const [win, id] of this._pendingConnections) {
            try { win.disconnect(id); } catch (_) { /* window may be gone */ }
        }
        this._pendingConnections.clear();
        this._processed.clear();
    }

    // ── Window discovery ───────────────────────────────────────────────────────

    /** Inspect every window that is already open when the extension loads. */
    _inspectExistingWindows() {
        for (const actor of global.get_window_actors()) {
            const win = actor.get_meta_window();
            if (win) this._scheduleInspection(win);
        }
    }

    /**
     * Schedule a deferred inspection for a newly created (or existing) window.
     *
     * We delay because:
     *  - Wayland apps set `gtk_application_id` asynchronously.
     *  - XWayland apps may not have wm_class ready on the first tick.
     */
    _scheduleInspection(win) {
        // Bail early if the window type will never have a useful app entry.
        const type = win.get_window_type();
        if (type !== Meta.WindowType.NORMAL &&
            type !== Meta.WindowType.DIALOG &&
            type !== Meta.WindowType.MODAL_DIALOG) {
            return;
        }

        GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, WINDOW_INSPECT_DELAY_MS, () => {
            this._inspectWindow(win);
            return GLib.SOURCE_REMOVE;
        });
    }

    // ── Core inspection logic ──────────────────────────────────────────────────

    /**
     * Inspect a single window and attempt to fix its icon association if broken.
     * @param {Meta.Window} win
     */
    _inspectWindow(win) {
        try {
            const title = win.get_title() ?? '(no title)';

            // ── 1. Ask the tracker first — cheapest check, no string work needed.
            const tracker    = Shell.WindowTracker.get_default();
            const currentApp = tracker.get_window_app(win);

            if (this._isValidApp(currentApp)) {
                // Already matched correctly — nothing to do.
                return;
            }

            // ── 2. Tracker failed. Read identifiers only now.
            const wmClass = win.get_wm_class() ?? '';
            const appId   = win.get_gtk_application_id() ?? '';

            // ── 3. No identifiers at all (e.g. vkcube) — nothing we can match against.
            if (!wmClass && !appId) {
                log(`[IconFix] ✗ "${title}" is untracked and has no identifiers — skipping`);
                return;
            }

            // ── 4. De-duplicate so we don't re-run for every new window of the same app.
            const dedupeKey = wmClass || appId;
            if (this._processed.has(dedupeKey)) return;

            log(`[IconFix] ✗ "${title}" is untracked (wm_class="${wmClass}", app_id="${appId}")`);

            // ── 5. Try to find a matching .desktop entry.
            const candidate = this._findBestCandidate(wmClass, appId);
            if (candidate) {
                log(`[IconFix] ↳ Best candidate: ${candidate.get_id()} — applying fix`);
                this._applyPersistentFix(wmClass, appId, candidate);
            } else {
                log(`[IconFix] ↳ No candidate found — cannot fix automatically`);
            }

            // Mark as processed regardless so we don't retry on every new window.
            this._processed.add(dedupeKey);
        } catch (err) {
            logError(err, '[IconFix] _inspectWindow failed');
        }
    }

    /**
     * Return true when `app` is a real, resolved application (not a fallback
     * "window:" pseudo-app that GNOME creates for unmatched windows).
     * @param {Shell.App|null} app
     */
    _isValidApp(app) {
        if (!app) return false;
        const id = app.get_id();
        if (!id) return false;
        // GNOME creates synthetic ids like "window:12345" for unmatched windows.
        if (id.startsWith('window:')) return false;
        return true;
    }

    // ── Candidate matching ─────────────────────────────────────────────────────

    /**
     * Search through all installed apps to find the best match for this window.
     *
     * Strategy (ordered by priority):
     *  1. Exact lookup by `appId` (with and without `.desktop` suffix).
     *  2. Exact lookup by `wmClass` as a desktop file name.
     *  3. Exact match on `StartupWMClass` field.
     *  4. Heuristic substring / partial match scored 0–100.
     *
     * @param {string} wmClass
     * @param {string} appId
     * @returns {Shell.App|null}
     */
    _findBestCandidate(wmClass, appId) {
        const appSystem = Shell.AppSystem.get_default();

        // ── 1. Direct appId lookup ─────────────────────────────────────────────
        if (appId) {
            for (const id of [appId, `${appId}.desktop`]) {
                const app = appSystem.lookup_app(id);
                if (app) {
                    log(`[IconFix]   match via appId lookup: ${app.get_id()}`);
                    return app;
                }
            }
        }

        // ── 2. Direct wmClass lookup ───────────────────────────────────────────
        if (wmClass) {
            for (const id of [
                `${wmClass}.desktop`,
                `${wmClass.toLowerCase()}.desktop`,
            ]) {
                const app = appSystem.lookup_app(id);
                if (app) {
                    log(`[IconFix]   match via wmClass lookup: ${app.get_id()}`);
                    return app;
                }
            }
        }

        // ── 3 & 4. Scan all installed apps ─────────────────────────────────────
        const wmLower  = wmClass.toLowerCase();
        const appLower = appId.toLowerCase();

        let bestApp   = null;
        let bestScore = 0;

        for (const app of appSystem.get_installed()) {
            const info = app.get_app_info();
            if (!info) continue;

            // 3. StartupWMClass exact match — highest confidence, return immediately.
            const startupWMClass = info.get_string('StartupWMClass');
            if (startupWMClass && wmClass &&
                startupWMClass.toLowerCase() === wmLower) {
                log(`[IconFix]   match via StartupWMClass: ${app.get_id()}`);
                return app;
            }

            const score = this._scoreCandidate(app, wmLower, appLower);
            if (score > bestScore) {
                bestScore = score;
                bestApp   = app;
            }
        }

        if (bestScore >= MIN_MATCH_SCORE) {
            log(`[IconFix]   heuristic match (score=${bestScore}): ${bestApp.get_id()}`);
            return bestApp;
        }

        return null;
    }

    /**
     * Compute a heuristic similarity score (0–100) between an installed app
     * and the window identifiers.
     *
     * @param {Shell.App} app
     * @param {string} wmLower   — lower-cased wm_class
     * @param {string} appLower  — lower-cased gtk_application_id
     * @returns {number}
     */
    _scoreCandidate(app, wmLower, appLower) {
        const desktopId  = (app.get_id() ?? '').toLowerCase().replace(/\.desktop$/, '');
        const appName    = (app.get_name() ?? '').toLowerCase();

        // Extract the short name from a reverse-DNS id like "org.mozilla.Firefox"
        const reverseDnsParts = desktopId.split('.');
        const shortId = reverseDnsParts[reverseDnsParts.length - 1];

        let score = 0;

        // wm_class ↔ desktop-id comparisons
        if (wmLower && desktopId === wmLower)                        score = Math.max(score, 95);
        if (wmLower && desktopId.includes(wmLower))                  score = Math.max(score, 80);
        if (wmLower && wmLower.includes(desktopId) && desktopId.length > 3)
                                                                     score = Math.max(score, 70);
        if (wmLower && shortId && wmLower.includes(shortId) && shortId.length > 3)
                                                                     score = Math.max(score, 65);

        // wm_class ↔ app name comparisons
        if (wmLower && appName === wmLower)                          score = Math.max(score, 85);
        if (wmLower && appName.includes(wmLower))                    score = Math.max(score, 60);
        if (wmLower && wmLower.includes(appName) && appName.length > 3)
                                                                     score = Math.max(score, 55);

        // gtk_application_id ↔ desktop-id comparisons
        if (appLower && desktopId === appLower)                      score = Math.max(score, 90);
        if (appLower && desktopId.includes(appLower))                score = Math.max(score, 75);

        // Partial match on the last segment of reverse-DNS app_id
        if (appLower) {
            const appIdShort = appLower.split('.').pop();
            if (appIdShort && appIdShort.length > 3 && desktopId.includes(appIdShort))
                                                                     score = Math.max(score, 45);
        }

        return score;
    }

    // ── Persistent fix (.desktop patching) ────────────────────────────────────

    /**
     * Create a patched copy of the candidate's .desktop file in the user's
     * application directory with `StartupWMClass` set to `wmClass`.
     *
     * If the original already has the correct StartupWMClass we do nothing.
     * If a fix file already exists on disk we skip creation.
     *
     * @param {string}     wmClass
     * @param {string}     appId
     * @param {Shell.App}  app
     */
    _applyPersistentFix(wmClass, appId, app) {
        try {
            const info = app.get_app_info();
            if (!info) {
                log('[IconFix] _applyPersistentFix: app has no AppInfo, skipping');
                return;
            }

            // Nothing to do if the original already declares the right WMClass.
            const existingWMClass = info.get_string('StartupWMClass');
            if (existingWMClass === wmClass) {
                log(`[IconFix] ${app.get_id()} already has StartupWMClass=${wmClass}`);
                return;
            }

            // Sanitise wmClass for use in a filename (replace problematic chars).
            const safeKey = (wmClass || appId).replace(/[^a-zA-Z0-9._-]/g, '_');
            const fixPath = `${USER_APP_DIR}/${FIX_PREFIX}${safeKey}.desktop`;

            const fixFile = Gio.File.new_for_path(fixPath);
            if (fixFile.query_exists(null)) {
                log(`[IconFix] Fix already on disk: ${fixPath}`);
                return;
            }

            // Ensure the destination directory exists.
            const userAppDir = Gio.File.new_for_path(USER_APP_DIR);
            if (!userAppDir.query_exists(null)) {
                userAppDir.make_directory_with_parents(null);
            }

            this._writeFixedDesktopFile(info, wmClass, fixPath);

        } catch (err) {
            logError(err, '[IconFix] _applyPersistentFix failed');
        }
    }

    /**
     * Read the original .desktop file, patch / inject StartupWMClass, and write
     * the result to `outputPath`.
     *
     * @param {Gio.DesktopAppInfo} info
     * @param {string} wmClass
     * @param {string} outputPath
     */
    _writeFixedDesktopFile(info, wmClass, outputPath) {
        const sourceFile = Gio.File.new_for_path(info.get_filename());
        const [ok, rawBytes] = sourceFile.load_contents(null);
        if (!ok) {
            log('[IconFix] Could not read source .desktop file');
            return;
        }

        let content = new TextDecoder('utf-8').decode(rawBytes);

        // Patch or inject the StartupWMClass key inside [Desktop Entry].
        if (/^StartupWMClass=/m.test(content)) {
            // Replace existing (possibly wrong) value.
            content = content.replace(
                /^StartupWMClass=.*$/m,
                `StartupWMClass=${wmClass}`
            );
        } else {
            // Inject the key right after the [Desktop Entry] section header.
            content = content.replace(
                /^(\[Desktop Entry\]\s*\n)/m,
                `$1StartupWMClass=${wmClass}\n`
            );
        }

        // Prepend a header comment so the file's origin is traceable.
        const header = [
            '# Auto-generated by the Icon Fix GNOME Shell extension.',
            `# Source: ${info.get_filename()}`,
            `# Added StartupWMClass=${wmClass}`,
            '',
        ].join('\n');

        const finalContent = header + content;

        // Write the file atomically via a replace stream.
        const outFile = Gio.File.new_for_path(outputPath);
        const stream  = outFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
        const dos     = Gio.DataOutputStream.new(stream);
        dos.put_string(finalContent, null);
        dos.close(null);

        log(`[IconFix] ✔ Wrote fix: ${outputPath}`);
        log('[IconFix]   Changes take effect after the app is relaunched.');
    }
}
