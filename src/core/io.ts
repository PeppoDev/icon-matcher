import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { USER_APP_DIR } from "../constants.js";
import { logger } from "./logger.js";

Gio._promisify(Gio.Subprocess.prototype, "wait_check_async");
Gio._promisify(Gio.File.prototype, "load_contents_async");
Gio._promisify(Gio.File.prototype, "query_info_async");
Gio._promisify(Gio.File.prototype, "make_directory_async");
Gio._promisify(Gio.File.prototype, "enumerate_children_async");
Gio._promisify(Gio.File.prototype, "delete_async");
Gio._promisify(Gio.FileEnumerator.prototype, "next_files_async");
Gio._promisify(Gio.FileEnumerator.prototype, "close_async");

const ENUMERATE_BATCH = 32;

export async function readBytes(file: Gio.File): Promise<Uint8Array> {
  const [contents] = await file.load_contents_async(null);
  return contents;
}

export async function readText(file: Gio.File): Promise<string> {
  return new TextDecoder("utf-8").decode(await readBytes(file));
}

export function writeText(file: Gio.File, text: string): Promise<void> {
  const bytes = new GLib.Bytes(new TextEncoder().encode(text));

  return new Promise((resolve, reject) => {
    file.replace_contents_bytes_async(
      bytes,
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
      (_file, result) => {
        try {
          file.replace_contents_finish(result);
          resolve();
        } catch (err) {
          reject(err);
        }
      },
    );
  });
}

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

export async function ensureDir(dir: Gio.File): Promise<void> {
  try {
    await dir.make_directory_async(GLib.PRIORITY_DEFAULT, null);
  } catch (err) {
    if (
      err instanceof GLib.Error &&
      err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)
    )
      return;
    if (
      err instanceof GLib.Error &&
      err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
    ) {
      dir.make_directory_with_parents(null);
      return;
    }
    throw err;
  }
}

export async function listChildren(dir: Gio.File): Promise<Gio.File[]> {
  let enumerator: Gio.FileEnumerator;
  try {
    enumerator = await dir.enumerate_children_async(
      "standard::name",
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      null,
    );
  } catch (err) {
    if (
      err instanceof GLib.Error &&
      err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)
    )
      return [];
    throw err;
  }

  const children: Gio.File[] = [];
  try {
    let infos: Gio.FileInfo[];
    do {
      infos = await enumerator.next_files_async(
        ENUMERATE_BATCH,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      for (const info of infos) children.push(dir.get_child(info.get_name()));
    } while (infos.length > 0);
  } finally {
    await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
  }
  return children;
}

export async function updateDesktopDatabase(
  dir: string = USER_APP_DIR,
): Promise<void> {
  try {
    const proc = Gio.Subprocess.new(
      ["update-desktop-database", dir],
      Gio.SubprocessFlags.NONE,
    );
    await proc.wait_check_async(null);
  } catch (err) {
    logger.warn("update-desktop-database failed", err);
  }
}

export async function deleteFile(file: Gio.File): Promise<void> {
  await file.delete_async(GLib.PRIORITY_DEFAULT, null);
}

const KEY_FILE_FLAGS =
  GLib.KeyFileFlags.KEEP_COMMENTS | GLib.KeyFileFlags.KEEP_TRANSLATIONS;

export async function loadKeyFile(file: Gio.File): Promise<GLib.KeyFile> {
  const keyFile = new GLib.KeyFile();
  keyFile.load_from_bytes(await readBytes(file), KEY_FILE_FLAGS);
  return keyFile;
}

export async function saveKeyFile(file: Gio.File, keyFile: GLib.KeyFile) {
  const [data] = keyFile.to_data();
  await writeText(file, data);
}
