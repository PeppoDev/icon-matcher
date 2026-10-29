import type Meta from "gi://Meta";
import { MappedWindow, HeurisctWindow } from "../types.js";
import { steamGameIdFromWmClass } from "../utils/steam.js";
import { normalize } from "../utils/normalize.js";

export function toMappedWindow(win: Meta.Window): MappedWindow {
  return {
    wmClass: win.get_wm_class() ?? "",
    appId: win.get_gtk_application_id() ?? "",
    title: win.get_title() ?? "",
  };
}

export function toHeuristicWindow(win: MappedWindow): HeurisctWindow {
  return {
    wm: win.wmClass.toLowerCase().trim(),
    appId: win.appId.toLowerCase().trim(),
    title: normalize(win.title),
    steamGameId: steamGameIdFromWmClass(win.wmClass),
  };
}
