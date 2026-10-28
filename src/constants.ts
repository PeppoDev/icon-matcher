import GLib from "gi://GLib";
import Meta from "gi://Meta";

export const USER_APP_DIR = `${GLib.get_user_data_dir()}/applications`;
export const MATCHED_DIR = `${USER_APP_DIR}/icons-matched`;

export const WINDOW_INSPECT_DELAY_MS = 1500;
export const TITLE_RETRY_DELAY_MS = 500;
export const MAX_TITLE_RETRIES = 3;

export const WINDOW_CREATED = "window-created";
export const WINDOW_UNMANAGED = "unmanaged";
export const NOTIFY_WMCLASS = "notify::wm-class";
export const NOTIFY_TITLE = "notify::title";
export const NOTIFY_SETTINGS_CHANGED = "changed";
export const APPS_INSTALLED_CHANGED = "installed-changed";
export const LOGGER_PREFIX = "[IconMatcher] ";
export const ALLOWED_WINDOW_TYPES = [
  Meta.WindowType.NORMAL,
  Meta.WindowType.DESKTOP,
  Meta.WindowType.DIALOG,
  Meta.WindowType.MODAL_DIALOG,
];

export const MIN_MATCH_SCORE = 50;
export const MIN_STRING_LENGTH = 3;
export const FALLBACK_ICON = "application-x-executable";
export const DETERMINISTIC_SCORE = 100;
export const STEAM_EXEC_SCORE = 99;

export const SettingsKey = {
  debug: "debug",
  blacklist: "blacklisted-wm-classes",
} as const;
