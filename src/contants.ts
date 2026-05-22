import GLib from "gi://GLib";

const USER_APP_DIR = `${GLib.get_home_dir()}/.local/share/applications`;
const MATCHED_DIR = `${USER_APP_DIR}/icons-matched`;
const MIN_MATCH_SCORE = 50;
const WINDOW_INSPECT_DELAY_MS = 1500;
const WINDOW_CREATED = "window-created";
const NOTIFY_WMCLASS = "notify::wm-class";
const NOTIFY_SETTINGS_CHANGED = "changed";
const MIN_STRING_LENGTH = 3;
const FALLBACK_ICON = "application-x-executable";

export {
  FALLBACK_ICON,
  MATCHED_DIR,
  MIN_MATCH_SCORE,
  MIN_STRING_LENGTH,
  NOTIFY_SETTINGS_CHANGED,
  NOTIFY_WMCLASS,
  USER_APP_DIR,
  WINDOW_CREATED,
  WINDOW_INSPECT_DELAY_MS,
};
