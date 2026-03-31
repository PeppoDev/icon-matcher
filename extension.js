import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Shell from "gi://Shell";
import Meta from "gi://Meta";

// Constants
const USER_APP_DIR = `${GLib.get_home_dir()}/.local/share/applications`;
const MATCHED_DIR = `${USER_APP_DIR}/icons-matched`;
const MIN_MATCH_SCORE = 50;
const WINDOW_INSPECT_DELAY_MS = 1000;

export default class IconFixExtension {
  enable() {
    this._processed = new Set();
    this._pendingConnections = new Map();
    this._timeoutSources = new Set();

    this._displayConnectionId = global.display.connect(
      "window-created",
      (_display, win) => this._scheduleInspection(win),
    );

    // TODO: Create a toggle for this
    // It is impacting on startup performance
    // this._inspectExistingWindows();
  }

  disable() {
    if (this._displayConnectionId) {
      global.display.disconnect(this._displayConnectionId);
      this._displayConnectionId = null;
    }

    for (const id of this._timeoutSources) GLib.Source.remove(id);
    this._timeoutSources.clear();

    for (const [win, id] of this._pendingConnections) {
      try {
        win.disconnect(id);
      } catch (err) {
        console.error("[IconMatcher] window disconnection failed", err);
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
    const ALLOWED_WINDOW_TYPES = [
      Meta.WindowType.NORMAL,
      Meta.WindowType.DIALOG,
      Meta.WindowType.MODAL_DIALOG,
    ];

    const type = win.get_window_type();
    if (!ALLOWED_WINDOW_TYPES.includes(type)) {
      return;
    }

    const id = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      WINDOW_INSPECT_DELAY_MS,
      () => {
        this._timeoutSources.delete(id);
        this._inspectWindow(win);
        return GLib.SOURCE_REMOVE;
      },
    );
    this._timeoutSources.add(id);
  }

  _inspectWindow(win) {
    try {
      const title = win.get_title();

      // TODO: Improve it with a retry system
      if (!title) {
        if (!this._pendingConnections.has(win)) {
          const id = win.connect("notify::title", () => {
            win.disconnect(id);
            this._pendingConnections.delete(win);
            this._inspectWindow(win);
          });
          this._pendingConnections.set(win, id);
          // console.log(
          //   `[IconMatcher] window has no title yet, waiting for notify::title`,
          // );
        }
        return;
      }

      const tracker = Shell.WindowTracker.get_default();
      const currentApp = tracker.get_window_app(win);

      if (this._isValidApp(currentApp)) {
        return;
      }

      const wmClass = win.get_wm_class() ?? "";
      const appId = win.get_gtk_application_id() ?? "";

      if (!wmClass && !appId) {
        // console.log(
        //   `[IconMatcher] ✗ "${title ?? "(no title)"}" is untracked and has no identifiers — skipping`,
        // );
        return;
      }

      // Avoid reprocessing
      const dedupeKey = wmClass || appId;
      if (this._processed.has(dedupeKey)) return;

      // console.log(
      //   `[IconMatcher] ✗ "${title}" is untracked (wm_class="${wmClass}", app_id="${appId}")`,
      // );

      const candidate = this._findBestCandidate(wmClass, appId, title);
      if (candidate) {
        console.log(
          `[IconMatcher] 	✔ Best candidate: ${candidate.get_id()} — applying fix`,
        );
        this._applyPersistentFix(wmClass, appId, candidate);
      } else {
        console.log(
          `[IconMatcher] -> No candidate found, cannot fix automatically`,
        );
      }

      this._processed.add(dedupeKey);
    } catch (err) {
      console.error("[IconMatcher] _inspectWindow failed", err);
    }
  }

  _isValidApp(app) {
    if (!app) return false;

    const id = app.get_id();
    if (!id) return false;
    if (id.startsWith("window:")) return false;

    return true;
  }

  _deterministicMatch(appSystem, wmClass, appId, title) {
    const wmLower = wmClass.toLowerCase().trim();
    const appLower = appId.toLowerCase().trim();
    const titleLower = title.toLowerCase().trim();

    if (title) {
      for (const id of [`${title}.desktop`, `${titleLower}.desktop`]) {
        const app = appSystem.lookup_app(id);
        if (app) {
          return app;
        }
      }
    }

    if (appId) {
      for (const id of [`${appLower}.desktop`]) {
        const app = appSystem.lookup_app(id);
        if (app) {
          return app;
        }
      }
    }

    if (wmClass) {
      for (const id of [`${wmClass}.desktop`, `${wmLower}.desktop`]) {
        const app = appSystem.lookup_app(id);
        if (app) {
          return app;
        }
      }
    }
  }

  _heuristichMatch(appSystem, wmClass, appId, title) {
    let bestApp = null;
    let bestScore = 0;
    const apps = appSystem.get_installed();

    for (const app of apps) {
      const info = Gio.DesktopAppInfo.new(app.get_id());
      if (!info) continue;

      const score = this._scoreCandidate(app, wmClass, appId, title);
      if (score > bestScore) {
        bestScore = score;
        bestApp = app;
      }
    }

    if (bestScore >= MIN_MATCH_SCORE) {
      console.log(
        `[IconMatcher]   heuristic match (score=${bestScore}): ${bestApp.get_id()}`,
      );
      return bestApp;
    }
  }

  _findBestCandidate(wmClass = "", appId = "", title = "") {
    const appSystem = Shell.AppSystem.get_default();

    // console.log(
    //   `[IconMatcher] -> Finding best candidate for "${wmClass}" and "${title} and "${appId}""`,
    // );

    const obviousMatch = this._deterministicMatch(
      appSystem,
      wmClass,
      appId,
      title,
    );

    if (obviousMatch) {
      console.log(`[IconMatcher] -> Found by deterministic method`);
      return obviousMatch;
    }

    const bestMatch = this._heuristichMatch(appSystem, wmClass, appId, title);

    if (bestMatch) {
      console.log(`[IconMatcher] -> Found by heuristic method`);
      return bestMatch;
    }

    return null;
  }

  _scoreCandidate(app, wm, appId, title) {
    const desktopId = (app.get_id() ?? "")
      .toLowerCase()
      .replace(/\.desktop$/, "");
    const appName = (app.get_name() ?? "").toLowerCase();

    // Just in case of dns-like desktopId
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

    // Metadata match
    if (wm) {
      if (desktopId === wm) score = Math.max(score, 93);
      if (desktopId.includes(wm) && wm.length > 3) score = Math.max(score, 80);
      if (wm.includes(desktopId) && desktopId.length > 3)
        score = Math.max(score, 70);
      if (
        shortDesktopId &&
        wm.includes(shortDesktopId) &&
        shortDesktopId.length > 3
      )
        score = Math.max(score, 66);
      if (appName === wm) score = Math.max(score, 85);
      if (appName.includes(wm) && wm.length > 3) score = Math.max(score, 60);
      if (wm.includes(appName) && appName.length > 3)
        score = Math.max(score, 55);
    }

    if (appId) {
      if (desktopId.includes(appId) && appId.length > 3)
        score = Math.max(score, 75);
    }

    // Window title match, seems to be more effective than the others
    // Careful about inclusions
    const titleNormalized = this._normalize(title);
    const desktopNormalized = this._normalize(desktopId);
    const appNameNormalized = this._normalize(appName);
    const shortIdNormalized = this._normalize(shortDesktopId);

    if (titleNormalized && titleNormalized.length > 3) {
      if (titleNormalized === desktopNormalized) score = Math.max(score, 98);
      if (titleNormalized === appNameNormalized) score = Math.max(score, 95);
      if (titleNormalized === shortIdNormalized) score = Math.max(score, 94);

      if (appNameNormalized.includes(titleNormalized))
        score = Math.max(score, 65);
      if (titleNormalized.includes(desktopNormalized))
        score = Math.max(score, 68);
    }

    return score;
  }

  _normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  _applyPersistentFix(wmClass, appId, app) {
    // TODO: Make it work overriding the original .desktop file
    try {
      const info = Gio.DesktopAppInfo.new(app.get_id());
      if (!info) {
        console.log(
          "[IconMatcher] _applyPersistentFix: app has no AppInfo, skipping",
        );
        return;
      }

      // Some guards to avoid mistake, need to improve the isValidApp method
      const desktopId = app
        .get_id()
        .replace(/\.desktop$/, "")
        .toLowerCase();
      if (desktopId === appId.toLowerCase()) {
        console.log(
          `[IconMatcher] desktop name "${desktopId}" matches appid, no need for fixing.`,
        );
        return;
      }

      const existingWMClass = info.get_string("StartupWMClass");
      if (existingWMClass === wmClass) {
        console.log(
          `[IconMatcher] ${app.get_id()} already has StartupWMClass=${wmClass}`,
        );
        return;
      }
      const icon = info.get_icon();

      if (!icon) {
        console.log(`[IconMatcher] ${app.get_id()} does not have any icon`);
        return;
      }

      const fixPath = `${MATCHED_DIR}/${wmClass}.desktop`;

      const fixFile = Gio.File.new_for_path(fixPath);
      if (fixFile.query_exists(null)) {
        console.log(`[IconMatcher] Fix already on disk: ${fixPath}`);
        return;
      }

      const matchedDir = Gio.File.new_for_path(MATCHED_DIR);
      if (!matchedDir.query_exists(null)) {
        matchedDir.make_directory_with_parents(null);
      }

      this._writeFixedDesktopFile(info, wmClass, fixPath);
      this._updateDesktopDatabase();
    } catch (err) {
      console.error("[IconMatcher] _applyPersistentFix failed", err);
    }
  }

  _writeFixedDesktopFile(info, wmClass, outputPath) {
    const sourceFile = Gio.File.new_for_path(info.get_filename());
    const [ok, rawBytes] = sourceFile.load_contents(null);
    if (!ok) {
      console.log("[IconMatcher] Could not read source .desktop file");
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

    // Hide to avoid showing in the app grid or search results
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

    const outFile = Gio.File.new_for_path(outputPath);
    const stream = outFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const dos = Gio.DataOutputStream.new(stream);
    dos.put_string(finalContent, null);
    dos.close(null);

    console.log(`[IconMatcher]   Wrote fix: ${outputPath}`);
  }

  _updateDesktopDatabase() {
    try {
      const proc = Gio.Subprocess.new(
        ["update-desktop-database", USER_APP_DIR],
        Gio.SubprocessFlags.NONE,
      );

      proc.wait_async(null, (_proc, result) => {
        _proc.wait_finish(result);
        console.log(
          "[IconMatcher]   update-desktop-database completed — fix is active",
        );
      });
    } catch (err) {
      console.error(
        "[IconMatcher] Could not launch update-desktop-database",
        err,
      );
    }
  }
}
