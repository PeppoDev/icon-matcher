import type Meta from "gi://Meta";
import { MappedWindow } from "../types.js";

export function windowMapper(win: Meta.Window): MappedWindow {
  return {
    wmClass: win.get_wm_class() ?? "",
    appId: win.get_gtk_application_id() ?? "",
    title: win.get_title() ?? "",
    // Phase 2: unused until launcher providers
    pid: Number(win.get_pid()) || 0,
    sandboxedAppId: win.get_sandboxed_app_id() ?? "",
  };
}
