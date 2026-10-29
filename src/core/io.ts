import Gio from "gi://Gio";
import GLib from "gi://GLib";

Gio._promisify(Gio.File.prototype, "query_info_async");

export async function fileExists(file: Gio.File): Promise<boolean> {
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
