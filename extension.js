import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Shell from "gi://Shell";
import Meta from "gi://Meta";

// Constants
const USER_APP_DIR = `${GLib.get_home_dir()}/.local/share/applications`;
const MATCHED_DIR = `${USER_APP_DIR}/icons-matched`;
const MIN_MATCH_SCORE = 50;
const WINDOW_INSPECT_DELAY_MS = 600;

export default class IconFixExtension {
  enable() {
    log("[IconMatcher] Extension enabled");

    this._processed = new Set();
    this._pendingConnections = new Map();

    this._displayConnectionId = global.display.connect(
      "window-created",
      (_display, win) => this._scheduleInspection(win),
    );

    this._inspectExistingWindows();
  }

  disable() {
    log("[IconMatcher] Extension disabled");

    if (this._displayConnectionId) {
      global.display.disconnect(this._displayConnectionId);
      this._displayConnectionId = null;
    }

    for (const [win, id] of this._pendingConnections) {
      try {
        win.disconnect(id);
      } catch (err) {
        logError(err, "[IconMatcher] window desconnection failed");
      }
    }
    this._pendingConnections.clear();
    this._processed.clear();
  }

  _inspectExistingWindows() {
    for (const actor of global.get_window_actors()) {
      const win = actor.get_meta_window();
      if (win) this._scheduleInspection(win);
    }
  }

  _scheduleInspection(win) {
    const type = win.get_window_type();
    if (
      type !== Meta.WindowType.NORMAL &&
      type !== Meta.WindowType.DIALOG &&
      type !== Meta.WindowType.MODAL_DIALOG
    ) {
      return;
    }

    GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      WINDOW_INSPECT_DELAY_MS,
      () => {
        this._inspectWindow(win);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _inspectWindow(win) {
    try {
      const title = win.get_title();

      const tracker = Shell.WindowTracker.get_default();
      const currentApp = tracker.get_window_app(win);

      if (this._isValidApp(currentApp)) {
        return;
      }

      const wmClass = win.get_wm_class() ?? "";
      const appId = win.get_gtk_application_id() ?? "";

      if (!wmClass && !appId) {
        log(
          `[IconMatcher] ✗ "${title ?? "(no title)"}" is untracked and has no identifiers — skipping`,
        );
        return;
      }

      // Avoid reprocessing
      const dedupeKey = wmClass || appId;
      if (this._processed.has(dedupeKey)) return;

      log(
        `[IconMatcher] ✗ "${title}" is untracked (wm_class="${wmClass}", app_id="${appId}")`,
      );

      const candidate = this._findBestCandidate(wmClass, appId, title);
      if (candidate) {
        log(
          `[IconMatcher] -> Best candidate: ${candidate.get_id()} — applying fix`,
        );
        this._applyPersistentFix(wmClass, candidate);
      } else {
        log(`[IconMatcher] -> No candidate found — cannot fix automatically`);
      }

      this._processed.add(dedupeKey);
    } catch (err) {
      logError(err, "[IconMatcher] _inspectWindow failed");
    }
  }

  _isValidApp(app) {
    if (!app) return false;

    const id = app.get_id();
    if (!id) return false;
    if (id.startsWith("window:")) return false;

    return true;
  }

  _findBestCandidate(wmClass = "", appId = "", title = "") {
    const appSystem = Shell.AppSystem.get_default();

    log(
      `[IconMatcher] -> Finding best candidate for "${wmClass}" and "${title} and "${appId}""`,
    );

    const wmLower = wmClass.toLowerCase().trim();
    const appLower = appId.toLowerCase().trim();
    const titleLower = title.trim().toLowerCase();

    if (title) {
      for (const id of [title, `${title}.desktop`, `${titleLower}.desktop`]) {
        const app = appSystem.lookup_app(id);
        if (app) {
          log(`[IconMatcher]   match via title lookup: ${app.get_id()}`);
          return app;
        }
      }
    }

    if (appId) {
      for (const id of [appId, `${appId}.desktop`, `${appLower}.desktop`]) {
        const app = appSystem.lookup_app(id);
        if (app) {
          log(`[IconMatcher]   match via appId lookup: ${app.get_id()}`);
          return app;
        }
      }
    }

    if (wmClass) {
      for (const id of [`${wmClass}.desktop`, `${wmLower}.desktop`]) {
        const app = appSystem.lookup_app(id);
        if (app) {
          log(`[IconMatcher]   match via wmClass lookup: ${app.get_id()}`);
          return app;
        }
      }
    }

    // Heuristic matching
    let bestApp = null;
    let bestScore = 0;

    for (const app of appSystem.get_installed()) {
      const info = Gio.DesktopAppInfo.new(app.get_id());
      if (!info) continue;

      const score = this._scoreCandidate(app, wmLower, appLower, titleLower);
      if (score > bestScore) {
        bestScore = score;
        bestApp = app;
      }
    }

    if (bestScore >= MIN_MATCH_SCORE) {
      log(
        `[IconMatcher]   heuristic match (score=${bestScore}): ${bestApp.get_id()}`,
      );
      return bestApp;
    }

    return null;
  }

  _scoreCandidate(app, wm, appId, title) {
    const desktopId = (app.get_id() ?? "")
      .toLowerCase()
      .replace(/\.desktop$/, "");
    const appName = (app.get_name() ?? "").toLowerCase();

    const shortDesktopId = desktopId.split(".").pop();

    // Prevent sub process ex: steam_app_1234 being matched to steam.desktop
    if (
      wm &&
      (wm.startsWith(`${desktopId}_`) ||
        wm.startsWith(`${shortDesktopId}_`) ||
        wm.startsWith(`${desktopId}-`) ||
        wm.startsWith(`${shortDesktopId}-`))
    )
      return 0;

    let score = 0;

    if (wm) {
      if (desktopId === wm) score = Math.max(score, 95);
      if (desktopId.includes(wm) && wm.length > 3) score = Math.max(score, 80);
      if (wm.includes(desktopId) && desktopId.length > 3)
        score = Math.max(score, 70);
      if (
        shortDesktopId &&
        wm.includes(shortDesktopId) &&
        shortDesktopId.length > 3
      )
        score = Math.max(score, 65);
      if (appName === wm) score = Math.max(score, 85);
      if (appName.includes(wm) && wm.length > 3) score = Math.max(score, 60);
      if (wm.includes(appName) && appName.length > 3)
        score = Math.max(score, 55);
    }

    if (appId) {
      if (desktopId === appId) score = Math.max(score, 90);
      if (desktopId.includes(appId) && appId.length > 3)
        score = Math.max(score, 75);
    }

    const titleNormalized = this._normalize(title);
    const desktopNormalized = this._normalize(desktopId);
    const appNameNormalized = this._normalize(appName);
    const shortIdNormalized = this._normalize(shortDesktopId);

    if (titleNormalized && titleNormalized.length > 3) {
      if (titleNormalized === desktopNormalized) score = Math.max(score, 98);
      if (titleNormalized === appNameNormalized) score = Math.max(score, 95);
      if (titleNormalized === shortIdNormalized) score = Math.max(score, 93);

      if (appNameNormalized.includes(titleNormalized))
        score = Math.max(score, 68);
      if (desktopNormalized.includes(titleNormalized))
        score = Math.max(score, 65);
    }

    return score;
  }

  _normalize(str) {
    return str.replace(/[^a-z0-9]/g, "");
  }

  _applyPersistentFix(wmClass, app) {
    // TODO: Make it work overriding the original .desktop file
    try {
      const info = Gio.DesktopAppInfo.new(app.get_id());
      if (!info) {
        log("[IconMatcher] _applyPersistentFix: app has no AppInfo, skipping");
        return;
      }

      const existingWMClass = info.get_string("StartupWMClass");
      if (existingWMClass === wmClass) {
        log(
          `[IconMatcher] ${app.get_id()} already has StartupWMClass=${wmClass}`,
        );
        return;
      }

      // TODO: At least create a option to override instead of creating a new file
      const fixPath = `${MATCHED_DIR}/${app.get_id()}`;

      const fixFile = Gio.File.new_for_path(fixPath);
      if (fixFile.query_exists(null)) {
        log(`[IconMatcher] Fix already on disk: ${fixPath}`);
        return;
      }

      const matchedDir = Gio.File.new_for_path(MATCHED_DIR);
      if (!matchedDir.query_exists(null)) {
        matchedDir.make_directory_with_parents(null);
      }

      this._writeFixedDesktopFile(info, wmClass, fixPath);
      this._updateDesktopDatabase();
    } catch (err) {
      logError(err, "[IconMatcher] _applyPersistentFix failed");
    }
  }

  _writeFixedDesktopFile(info, wmClass, outputPath) {
    const sourceFile = Gio.File.new_for_path(info.get_filename());
    const [ok, rawBytes] = sourceFile.load_contents(null);
    if (!ok) {
      log("[IconMatcher] Could not read source .desktop file");
      return;
    }

    let content = new TextDecoder("utf-8").decode(rawBytes);

    if (/^StartupWMClass=/m.test(content)) {
      content = content.replace(
        /^StartupWMClass=.*$/m,
        `StartupWMClass=${wmClass}`,
      );
    } else {
      content = content.replace(
        /^(\[Desktop Entry\]\s*\n)/m,
        `$1StartupWMClass=${wmClass}\n`,
      );
    }

    // Hid to avoid showing in the app grid or search results
    if (/^NoDisplay=/m.test(content)) {
      content = content.replace(/^NoDisplay=.*$/m, "NoDisplay=true");
    } else {
      content = content.replace(
        /^(\[Desktop Entry\]\s*\n)/m,
        `$1NoDisplay=true\n`,
      );
    }

    // Just to make it obvious, remove it later
    const header = [
      "# Auto-generated by the Icon Fix GNOME Shell extension.",
      `# Source: ${info.get_filename()}`,
      `# Added StartupWMClass=${wmClass}`,
      "",
    ].join("\n");

    const finalContent = header + content;

    // Write the file atomically via a replace stream.
    const outFile = Gio.File.new_for_path(outputPath);
    const stream = outFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const dos = Gio.DataOutputStream.new(stream);
    dos.put_string(finalContent, null);
    dos.close(null);

    log(`[IconMatcher]   Wrote fix: ${outputPath}`);
    log(
      "[IconMatcher]   Changes take effect after the app is relaunched or use update-desktop-database ~/.local/share/applications",
    );
  }

  _updateDesktopDatabase() {
    try {
      const proc = Gio.Subprocess.new(
        ['update-desktop-database', MATCHED_DIR],
        Gio.SubprocessFlags.NONE
      );

      proc.wait_async(null, (_proc, result) => {
        try {
          _proc.wait_finish(result);
          log('[IconMatcher]   update-desktop-database completed — fix is active');
        } catch (err) {
          logError(err, '[IconMatcher] update-desktop-database failed');
        }
      });
    } catch (err) {
      logError(err, '[IconMatcher] Could not launch update-desktop-database');
    }
  }
}

