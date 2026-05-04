import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Shell from "gi://Shell";
import Meta from "gi://Meta";

Gio._promisify(Gio.File.prototype, "load_contents_async");
Gio._promisify(
  Gio.File.prototype,
  "replace_contents_bytes_async",
  "replace_contents_finish",
);
Gio._promisify(Gio.File.prototype, "query_info_async");

// Constants
const USER_APP_DIR = `${GLib.get_home_dir()}/.local/share/applications`;
const MATCHED_DIR = `${USER_APP_DIR}/icons-matched`;
const MIN_MATCH_SCORE = 50;
const WINDOW_INSPECT_DELAY_MS = 1000;
const WINDOW_CREATED = "window-created";
const NOTIFY_TITLE = "notify::title";
const MIN_STRING_LENGTH = 3;
const DEBUG = false;

const FEATURE_TOGGLE = {
  OVERRIDE_ORIGINAL_FILE: false,
  SKIP_STARTUP_WM_CLASS: false,
};

const BLACKLISTED = [
  "org.gnome*",
  "gnome-shell*",
  "xdg*",
  "org.mozilla*",
  "teams-for-linux*",
  "google-chrome",
  "zoom",
  "steam",
];

export default class IconFixExtension {
  enable() {
    this._processed = new Set();
    this._pendingConnections = new Map();
    this._timeoutSources = new Set();

    this._displayConnectionId = global.display.connect(
      WINDOW_CREATED,
      (_display, win) => this._scheduleInspection(win),
    );
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
        this._logger.error("window disconnection failed", err);
      }
    }
    this._pendingConnections.clear();
    this._processed.clear();
  }

  _logger = {
    log: (...data) => this._loggerBuilder("log", ...data),
    error: (...data) => this._loggerBuilder("error", ...data),
  };

  _loggerBuilder(loglevel, ...data) {
    if (DEBUG) {
      console[loglevel]("[IconMatcher] ", ...data);
    }
  }

  _isFeatureEnabled(feature) {
    return !!FEATURE_TOGGLE[feature];
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
          const id = win.connect(NOTIFY_TITLE, () => {
            win.disconnect(id);
            this._pendingConnections.delete(win);
            this._inspectWindow(win);
          });
          this._pendingConnections.set(win, id);
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
        return;
      }

      // Its not right but probably better than letting it match wrong
      // It works because it represents an app that was developed with care
      // and probably it has the correct desktop file
      if (wmClass.toLowerCase() === appId.toLowerCase()) {
        this._logger.error(
          "wm_class and app_id are the same, skipping to avoid potential mismatch",
          wmClass,
        );
        return;
      }

      // Avoid reprocessing
      const dedupeKey = wmClass || appId;
      if (this._processed.has(dedupeKey)) return;

      this._logger.log(
        `✗ "${title}" is untracked (wm_class="${wmClass}", app_id="${appId}")`,
      );

      const candidate = this._findBestCandidate(wmClass, appId, title);
      if (candidate) {
        this._logger.log(
          `\t✔ Best candidate: ${candidate.get_id()} — applying fix`,
        );
        this._applyPersistentFix(wmClass, appId, candidate).catch((err) =>
          this._logger.error("_applyPersistentFix failed", err),
        );
      } else {
        this._logger.log(`-> No candidate found, cannot fix automatically`);
      }

      this._processed.add(dedupeKey);
    } catch (err) {
      this._logger.error("_inspectWindow failed", err);
    }
  }

  // Some apps seems to be null even though they are eventually valid
  // Seems to increase the dealy time works but its not a silver bullet
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
      const app = appSystem.lookup_app(`${appLower}.desktop`);
      if (app) {
        return app;
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
    const bestMatch = {
      app: null,
      score: 0,
    };

    const apps = appSystem.get_installed();

    for (const app of apps) {
      const info = Gio.DesktopAppInfo.new(app.get_id());
      if (!info) continue;

      const score = this._scoreCandidate(app, wmClass, appId, title);
      if (score > bestMatch.score) {
        bestMatch.score = score;
        bestMatch.app = app;
      }
    }

    if (bestMatch.score >= MIN_MATCH_SCORE) {
      this._logger.log(
        `heuristic match (score=${bestMatch.score}): ${bestMatch.app.get_id()}`,
      );
      return bestMatch.app;
    }
  }

  _isBlackListed(wmClass) {
    const wmLower = wmClass.toLowerCase();

    if (!wmLower || wmLower.length < MIN_STRING_LENGTH) return false;

    for (const pattern of BLACKLISTED) {
      const isPrefix = pattern.endsWith("*");
      const term = isPrefix ? pattern.slice(0, -1) : pattern;
      const matched = isPrefix ? wmLower.startsWith(term) : wmLower === term;
      if (matched) return true;
    }
    return false;
  }

  _findBestCandidate(wmClass = "", appId = "", title = "") {
    const appSystem = Shell.AppSystem.get_default();

    const isBlackListed = this._isBlackListed(wmClass);
    if (isBlackListed) {
      this._logger.log(`-> Skipping blacklisted wm_class "${wmClass}"`);
      return null;
    }

    const obviousMatch = this._deterministicMatch(
      appSystem,
      wmClass,
      appId,
      title,
    );

    if (obviousMatch) {
      this._logger.log(`-> Found by deterministic method`);
      return obviousMatch;
    }

    const bestMatch = this._heuristichMatch(appSystem, wmClass, appId, title);

    if (bestMatch) {
      this._logger.log(`-> Found by heuristic method`);
      return bestMatch;
    }

    return null;
  }

  _isSteamXorgGame(app, wmClass) {
    const steamMatch = wmClass.match(/^steam_app_(\d+)$/i);
    if (!steamMatch) return false;

    const gameId = steamMatch[1];
    const info = Gio.DesktopAppInfo.new(app.get_id());
    const exec = info?.get_string("Exec") ?? "";
    return exec.includes(`steam://rungameid/${gameId}`);
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

    // Its almost guaranteed
    if (this._isSteamXorgGame(app, wm)) {
      return 99;
    }

    // Metadata match
    if (wm) {
      if (desktopId === wm) score = Math.max(score, 93);
      if (desktopId.includes(wm) && wm.length > MIN_STRING_LENGTH)
        score = Math.max(score, 80);
      if (wm.includes(desktopId) && desktopId.length > MIN_STRING_LENGTH)
        score = Math.max(score, 70);
      if (
        shortDesktopId &&
        wm.includes(shortDesktopId) &&
        shortDesktopId.length > MIN_STRING_LENGTH
      )
        score = Math.max(score, 66);
      if (appName === wm) score = Math.max(score, 85);
      if (appName.includes(wm) && wm.length > MIN_STRING_LENGTH)
        score = Math.max(score, 60);
      if (wm.includes(appName) && appName.length > MIN_STRING_LENGTH)
        score = Math.max(score, 55);
    }

    if (appId) {
      if (desktopId.includes(appId) && appId.length > MIN_STRING_LENGTH)
        score = Math.max(score, 75);
    }

    // Window title match, seems to be more effective than the others
    // Careful about inclusions
    const titleNormalized = this._normalize(title);
    const desktopNormalized = this._normalize(desktopId);
    const appNameNormalized = this._normalize(appName);
    const shortIdNormalized = this._normalize(shortDesktopId);

    if (titleNormalized && titleNormalized.length > MIN_STRING_LENGTH) {
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

  async _applyPersistentFix(wmClass, appId, app) {
    // TODO: Make it work overriding the original .desktop file
    const info = Gio.DesktopAppInfo.new(app.get_id());
    if (!info) {
      this._logger.log("_applyPersistentFix: app has no AppInfo, skipping");
      return;
    }

    // Some guards to avoid mistake, need to improve the isValidApp method
    const desktopId = app
      .get_id()
      .replace(/\.desktop$/, "")
      .toLowerCase();
    if (desktopId === appId.toLowerCase()) {
      this._logger.log(
        `desktop name "${desktopId}" matches appid, no need for fixing.`,
      );
      return;
    }

    const existingWMClass = info.get_string("StartupWMClass");
    if (existingWMClass) {
      this._logger.log(`${app.get_id()} already has StartupWMClass=${wmClass}`);
      return;
    }
    const icon = info.get_icon();
    if (!icon) {
      this._logger.log(`${app.get_id()} does not have any icon`);
      return;
    }

    const fixPath = `${MATCHED_DIR}/${wmClass}.desktop`;

    const fixFile = Gio.File.new_for_path(fixPath);

    const alreadyFixed = await this._fileExists(fixFile);

    if (alreadyFixed) {
      this._logger.log(`Fix already on disk: ${fixPath}`);
      return;
    }

    const matchedDir = Gio.File.new_for_path(MATCHED_DIR);
    const matchedDirExists = await this._fileExists(matchedDir);

    if (!matchedDirExists) {
      matchedDir.make_directory_with_parents(null);
    }

    await this._writeFixedDesktopFile(info, wmClass, fixPath);
    this._updateDesktopDatabase();
  }

  async _fileExists(file) {
    try {
      await file.query_info_async(
        "standard::type",
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      return true;
    } catch {
      return false;
    }
  }

  async _writeFixedDesktopFile(info, wmClass, outputPath) {
    const sourceFile = Gio.File.new_for_path(info.get_filename());
    const [rawBytes] = await sourceFile.load_contents_async(null);

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
    await outFile.replace_contents_bytes_async(
      new GLib.Bytes(finalContent),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
    );

    this._logger.log(`  Wrote fix: ${outputPath}`);
  }

  _updateDesktopDatabase() {
    try {
      const proc = Gio.Subprocess.new(
        ["update-desktop-database", USER_APP_DIR],
        Gio.SubprocessFlags.NONE,
      );

      proc.wait_async(null, (_proc, result) => {
        _proc.wait_finish(result);
        this._logger.log("update-desktop-database completed — fix is active");
      });
    } catch (err) {
      this._logger.error("Could not launch update-desktop-database", err);
    }
  }
}
