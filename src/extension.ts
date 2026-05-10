import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

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
const WINDOW_INSPECT_DELAY_MS = 1000;
const WINDOW_CREATED = "window-created";
const NOTIFY_WMCLASS = "notify::wm-class";
const MIN_STRING_LENGTH = 3;
const DEBUG = true;
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
  _displayConnectionId: number | null = null;

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

    // TODO: check if make sense
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
    this._logger.log("_scheduleInspection", win.title);
    const type = win.get_window_type();

    if (!ALLOWED_WINDOW_TYPES.includes(type)) {
      this._logger.log(`window type ${type} is not allowed, skipping`);
      return;
    }

    const id = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT_IDLE,
      WINDOW_INSPECT_DELAY_MS,
      () => {
        this._timeoutSources.delete(id);
        this._inspectWindow(win);
        // TODO check this
        return GLib.SOURCE_REMOVE;
      },
    );

    this._logger.log(
      `scheduled inspection for window ${win.title} with timeout id ${id}`,
    );
    this._timeoutSources.add(id);
  }

  _inspectWindow(win: Meta.Window) {
    try {
      this._logger.log("_inspectWindow", win.title);

      const wmClass = win.get_wm_class() ?? "";
      this._logger.log(`window ${win.title} wmClass: ${wmClass} `);

      // TODO: transform into a function
      if (!wmClass) {
        if (!this._pendingConnections.has(win)) {
          this._logger.log(
            `window ${win.title} has no title yet, connecting to ${NOTIFY_WMCLASS} signal to retry later`,
          );
          const id = win.connect(NOTIFY_WMCLASS, () => {
            win.disconnect(id);
            this._pendingConnections.delete(win);
            this._inspectWindow(win);
          });
          this._pendingConnections.set(win, id);
        }
        return;
      }

      const shouldUpdateApp = this._shouldUpdateApp(win);

      this._logger.log(`ShouldUpdateApp: ${shouldUpdateApp}`);

      if (!shouldUpdateApp) return;

      const appId = win.get_gtk_application_id() ?? "";
      const title = win.title ?? "";

      // Avoid reprocessing
      const dedupeKey = wmClass || appId;
      if (this._processed.has(dedupeKey)) return;

      const candidate = this._findBestCandidate(wmClass, appId, title);

      this._logger.log(`window details: wmClass=${wmClass}, appId=${appId}`);
    } catch (err) {
      this._logger.error("_inspectWindow failed", err);
    }
  }

  // TODO: improve it to receive every early return on inspect window
  _shouldUpdateApp(win: Meta.Window) {
    const wmClass = win.get_wm_class() ?? "";
    const appId = win.get_gtk_application_id() ?? "";

    // Not enough info to proceed
    // if (!wmClass) {
    //   this._logger.error(
    //     "window missing wm_class or app_id, skipping",
    //     win.title,
    //   );
    //   return false;
    // }

    // TODO: try to remove this
    if (wmClass?.toLowerCase() === appId?.toLowerCase()) {
      this._logger.error(
        "wm_class and app_id are the same, skipping to avoid potential mismatch",
        wmClass,
      );
      return false;
    }

    const isBlackListed = this._isBlackListed(wmClass);
    if (isBlackListed) {
      this._logger.log(`window wm_class ${wmClass} is blacklisted, skipping`);
      return false;
    }

    const tracker = Shell.WindowTracker.get_default();
    const currentApp = tracker.get_window_app(win);

    this._logger.log(
      `inspecting window title: ${win.title}, app: ${currentApp}`,
    );

    const icon = currentApp?.get_icon()?.to_string();

    this._logger.log(
      `APPINFO: ${currentApp?.appInfo}:${currentApp?.app_info}, ID: ${currentApp?.get_id()}, desc: ${currentApp?.get_description()} icon: ${icon}`,
    );

    if (!icon || icon === "application-x-executable") return true;

    return false;
  }

  _findBestCandidate(wmClass: string, appId: string, title: string) {
    this._logger.log(
      `_findBestCandidate called with wmClass=${wmClass}, appId=${appId}, title=${title}`,
    );
  }

  // TODO: add suffix
  _isBlackListed(wmClass: string) {
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
}
