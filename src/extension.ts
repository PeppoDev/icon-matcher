import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GioUnix from "gi://GioUnix";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

// types
type Nullable<T> = T | null | undefined;
type Candidate = {
  app: Nullable<Gio.AppInfo>;
  matchType: Nullable<"deterministic" | "heuristic">;
  score: number;
};

// promises
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
const WINDOW_INSPECT_DELAY_MS = 1500;
const WINDOW_CREATED = "window-created";
const NOTIFY_WMCLASS = "notify::wm-class";
const MIN_STRING_LENGTH = 3;
const DEBUG = true;
const FALLBACK_ICON = "application-x-executable";
const BLACKLISTED = [
  "org.gnome*",
  "gnome-shell*",
  "xdg*",
  "org.mozilla*",
  "steam",
];

const ALLOWED_WINDOW_TYPES = [
  Meta.WindowType.NORMAL,
  Meta.WindowType.DESKTOP,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
];

export default class MyExtension extends Extension {
  gsettings?: Gio.Settings;
  debugEnabled: boolean = DEBUG;
  _processed: Set<String> = new Set();
  _pendingConnections: Map<Meta.Window, number> = new Map();
  _timeoutSources: Set<number> = new Set();
  _displayConnectionId: Nullable<number> = null;

  enable() {
    this._logger.log("Enabling extension");
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
    log: (...data: any[]) => this._loggerBuilder("log", ...data),
    error: (...data: any[]) => this._loggerBuilder("error", ...data),
  };

  _loggerBuilder(loglevel: "log" | "error", ...data: any[]) {
    if (DEBUG) {
      console[loglevel]("[IconMatcher] ", ...data);
    }
  }

  _scheduleInspection(win: Meta.Window) {
    const type = win.get_window_type();

    if (!ALLOWED_WINDOW_TYPES.includes(type)) return;

    const id = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      WINDOW_INSPECT_DELAY_MS,
      () => {
        this._timeoutSources.delete(id);
        this._inspectWindow(win);
        return GLib.SOURCE_REMOVE;
      },
    );

    this._timeoutSources.add(id);
  }

  _inspectWindow(win: Meta.Window) {
    try {
      this._logger.log("Inspecting window", win.title);

      const wmClass = win.get_wm_class();
      if (!wmClass) {
        this._rescheduleWindow(win);
        return;
      }

      const shouldUpdateApp = this._shouldUpdateApp(win);
      this._logger.log(`Should update app: ${shouldUpdateApp}`);
      if (!shouldUpdateApp) return;

      const appId = win.get_gtk_application_id() ?? "";
      const title = win.title ?? "";

      if (this._processed.has(wmClass)) return;

      const candidate = this._findBestCandidate(wmClass, appId, title);
      if (candidate) {
        this._logger.log(
          `\t✔ Best candidate: ${candidate.app?.get_id()} — applying fix`,
        );
        this._applyPersistentFix(wmClass, candidate);
      } else {
        this._logger.log(`-> No candidate found, cannot fix automatically`);
      }

      this._processed.add(wmClass);

      this._logger.log(`window details: wmClass=${wmClass}, appId=${appId}`);
    } catch (err) {
      this._logger.error("_inspectWindow failed", err);
    }
  }

  _rescheduleWindow(win: Meta.Window) {
    if (!this._pendingConnections.has(win)) {
      this._logger.log(
        `window ${win.title} has no wmClass, connecting to ${NOTIFY_WMCLASS} signal to retry later`,
      );
      const id = win.connect(NOTIFY_WMCLASS, () => {
        win.disconnect(id);
        this._pendingConnections.delete(win);
        this._inspectWindow(win);
      });
      this._pendingConnections.set(win, id);
    }
  }

  _shouldUpdateApp(win: Meta.Window): boolean {
    const wmClass = win.get_wm_class() ?? "";

    const isBlackListed = this._isBlackListed(wmClass);
    if (isBlackListed) return false;

    const tracker = Shell.WindowTracker.get_default();
    const currentApp = tracker.get_window_app(win);

    if (!currentApp) return false;

    const icon = currentApp.get_icon()?.to_string();

    // TODO: remove later
    this._logger.log(
      `APPINFO: ${currentApp?.appInfo}:${currentApp?.app_info}, ID: ${currentApp.id}, desc: ${currentApp?.get_description()} icon: ${icon}`,
    );

    if (!icon || icon === FALLBACK_ICON) return true;

    // TODO: remove later
    this._logger.log("fallback return");
    return false;
  }

  _isBlackListed(wmClass: string): boolean {
    const wmLower = wmClass.toLowerCase();

    if (!wmLower || wmLower.length < MIN_STRING_LENGTH) return false;

    for (const pattern of BLACKLISTED) {
      const lowerPattern = pattern.toLowerCase();
      const startsWithWildcard = lowerPattern.startsWith("*");
      const endsWithWildcard = lowerPattern.endsWith("*");
      const term = lowerPattern.replace(/^\*|\*$/g, "");
      let matched = false;

      if (startsWithWildcard && endsWithWildcard) {
        matched = wmLower.includes(term);
      } else if (startsWithWildcard) {
        matched = wmLower.endsWith(term);
      } else if (endsWithWildcard) {
        matched = wmLower.startsWith(term);
      } else {
        matched = wmLower === term;
      }

      if (matched) {
        this._logger.log(`window wm_class ${wmClass} is blacklisted, skipping`);
        return true;
      }
    }

    return false;
  }

  _findBestCandidate(
    wmClass: string,
    appId: string,
    title: string,
  ): Nullable<Candidate> {
    this._logger.log(
      `_findBestCandidate called with wmClass=${wmClass}, appId=${appId}, title=${title}`,
    );

    const appSystem = Shell.AppSystem.get_default();

    const deterministicMatch = this._deterministicMatcher(
      appSystem,
      wmClass,
      appId,
      title,
    );

    if (deterministicMatch) {
      this._logger.log(`-> Found by deterministic method`);
      return deterministicMatch;
    }

    const heuristichMatch = this._heuristichMatcher(
      appSystem,
      wmClass,
      appId,
      title,
    );

    if (heuristichMatch) {
      this._logger.log(`-> Found by heuristic method`);
      return heuristichMatch;
    }

    return null;
  }

  _deterministicMatcher(
    appSystem: Shell.AppSystem,
    wmClass: string,
    appId: string,
    title: string,
  ): Nullable<Candidate> {
    const wmLower = wmClass.toLowerCase().trim();
    const appLower = appId.toLowerCase().trim();
    const titleLower = title.toLowerCase().trim();

    const match: Candidate = {
      app: null,
      score: 100,
      matchType: "deterministic",
    };

    if (title) {
      const result = this._lookUpByValues(appSystem, [
        `${title}.desktop`,
        `${titleLower}.desktop`,
      ]);
      if (result) match.app = result;
    } else if (appId) {
      const result = this._lookUpByValues(appSystem, [`${appLower}.desktop`]);
      if (result) match.app = result;
    } else if (wmClass) {
      const result = this._lookUpByValues(appSystem, [
        `${wmClass}.desktop`,
        `${wmLower}.desktop`,
      ]);
      if (result) match.app = result;
    }

    if (match.app) return match;
    return null;
  }

  _lookUpByValues(appSystem: Shell.AppSystem, values: string[]) {
    for (const id of values) {
      const app = appSystem.lookup_app(id);
      if (app) {
        return app.appInfo;
      }
    }
  }

  _heuristichMatcher(
    appSystem: Shell.AppSystem,
    wmClass: string,
    appId: string,
    title: string,
  ): Nullable<Candidate> {
    const bestMatch: Candidate = {
      app: null,
      score: 0,
      matchType: "heuristic",
    };

    const apps = appSystem.get_installed();

    for (const app of apps) {
      const icon = app.get_icon()?.to_string();

      if (!icon || icon === FALLBACK_ICON) {
        this._logger.log(
          `Skipping candidate ${app.get_id()} with no icon ${icon}`,
        );
        continue;
      }

      const score = this._scoreCandidate(app, wmClass, appId, title);
      if (score > bestMatch.score) {
        bestMatch.score = score;
        bestMatch.app = app;
      }
    }

    if (bestMatch.score >= MIN_MATCH_SCORE && bestMatch.app) {
      this._logger.log(
        `heuristic match (score=${bestMatch.score}): ${bestMatch.app.get_id()}`,
      );
      return bestMatch;
    }

    return null;
  }

  _scoreCandidate(
    app: Gio.AppInfo,
    wm: string,
    appId: string,
    title: string,
  ): number {
    if (this._isSteamXorgGame(app, wm)) {
      return 99;
    }

    const desktopId = (app.get_id() ?? "")
      .toLowerCase()
      .replace(/\.desktop$/, "");
    const appName = (app.get_name() ?? "").toLowerCase();

    // Just in case of dns-like desktopId
    const shortDesktopId = desktopId.split(".").pop() ?? "";

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

  _normalize(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  _isSteamXorgGame(app: Gio.AppInfo, wmClass: string): boolean {
    const steamMatch = wmClass.match(/^steam_app_(\d+)$/i);
    if (!steamMatch) return false;

    const gameId = steamMatch[1];
    const info = app.get_commandline();

    this._logger.log(
      `Checking if ${app.get_id()} is a steam game with command line: ${info}`,
    );
    if (!info) return false;
    return info.includes(`steam://rungameid/${gameId}`);
  }

  async _shouldApplyFix(
    id: string,
    candidate: Candidate,
    wmClass: string,
    fixPath: string,
  ): Promise<boolean> {
    const info = GioUnix.DesktopAppInfo.new(id);

    if (!info) {
      this._logger.log("_applyPersistentFix: app has no AppInfo, skipping");
      return false;
    }
    const existingWMClass = info.get_startup_wm_class();

    if (existingWMClass === wmClass) {
      this._logger.log(`${id} already has StartupWMClass=${wmClass}`);
      return false;
    }

    const icon = candidate.app?.get_icon();
    if (!icon) {
      this._logger.log(`${id} does not have any icon`);
      return false;
    }

    const fixFile = Gio.File.new_for_path(fixPath);
    const alreadyFixed = await this._fileExists(fixFile);
    if (alreadyFixed) {
      this._logger.log(`Fix already on disk: ${fixPath}`);
      return false;
    }

    return true;
  }

  async _applyPersistentFix(wmClass: string, candidate: Candidate) {
    const id = candidate.app?.get_id();
    if (!id) return;

    const fixPath = `${MATCHED_DIR}/${wmClass}.desktop`;
    const shouldApplyFix = await this._shouldApplyFix(
      id,
      candidate,
      wmClass,
      fixPath,
    );

    if (!shouldApplyFix) return;

    const info = GioUnix.DesktopAppInfo.new(id);

    const matchedDir = Gio.File.new_for_path(MATCHED_DIR);
    const matchedDirExists = await this._fileExists(matchedDir);

    if (!matchedDirExists) {
      matchedDir.make_directory_with_parents(null);
    }

    await this._writeFixedDesktopFile(info, wmClass, fixPath, candidate);
    this._updateDesktopDatabase();
  }

  async _fileExists(file: Gio.File): Promise<boolean> {
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

  async _writeFixedDesktopFile(
    info: GioUnix.DesktopAppInfo,
    wmClass: string,
    outputPath: string,
    candidate: Candidate,
  ) {
    const fileName = info.get_filename();
    if (!fileName) {
      this._logger.error("Cannot get filename from AppInfo, aborting fix");
      return;
    }

    const sourceFile = Gio.File.new_for_path(fileName);
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

    if (/^NoDisplay=/m.test(content)) {
      content = content.replace(/^NoDisplay=.*$/m, "NoDisplay=true");
    } else {
      content = content.replace(
        /^(\[Desktop Entry\]\s*\n)/m,
        `$1NoDisplay=true\n`,
      );
    }

    const header = [
      "# Auto-generated by the Icon Fix GNOME Shell extension.",
      `# Source: ${info.get_filename()}`,
      `# Search type: ${candidate.matchType}`,
      `# Score (deterministic is always 100): ${candidate.score}`,
      `# Added StartupWMClass=${wmClass}`,
      `# Added NoDisplay=true`,
      "",
    ].join("\n");

    const encoder = new TextEncoder();
    const finalContent = encoder.encode(header + content);

    const outFile = Gio.File.new_for_path(outputPath);
    outFile.replace_contents_bytes_async(
      new GLib.Bytes(finalContent),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
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
        _proc?.wait_finish(result);
        this._logger.log("update-desktop-database completed — fix is active");
      });
    } catch (err) {
      this._logger.error("Could not launch update-desktop-database", err);
    }
  }
}
