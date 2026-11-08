import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { DESKTOP_SUFFIX, MATCHED_DIR } from "../constants.js";
import {
  deleteFile,
  ensureDir,
  fileExists,
  listChildren,
  loadKeyFile,
  readBytes,
  saveKeyFile,
} from "../core/io.js";
import { logger } from "../core/logger.js";
import {
  DESKTOP_GROUP,
  headerComment,
  MetaKey,
  parseLegacyHeader,
  type EntryMetadata,
} from "../utils/metadata.js";
import { generatedFileName } from "../utils/naming.js";

const STRIPPED_KEYS = ["MimeType", "DBusActivatable"];
const STARTUP_WM_CLASS_KEY = "StartupWMClass";
const NO_DISPLAY_KEY = "NoDisplay";

export interface SyncReport {
  synced: number;
  skipped: number;
  failed: number;
  deleted: number;
}

export class GhostHandler {
  readonly dir: Gio.File;

  constructor(dirPath: string = MATCHED_DIR) {
    this.dir = Gio.File.new_for_path(dirPath);
  }

  #getString(keyFile: GLib.KeyFile, key: string): string | null {
    try {
      return keyFile.get_string(DESKTOP_GROUP, key);
    } catch {
      return null;
    }
  }

  #removeKey(keyFile: GLib.KeyFile, key: string) {
    try {
      keyFile.remove_key(DESKTOP_GROUP, key);
    } catch {
      logger.debug("Key not present");
    }
  }

  #applyGhostPatch(keyFile: GLib.KeyFile, meta: EntryMetadata) {
    keyFile.set_string(DESKTOP_GROUP, STARTUP_WM_CLASS_KEY, meta.wmClass);
    keyFile.set_boolean(DESKTOP_GROUP, NO_DISPLAY_KEY, true);
    for (const key of STRIPPED_KEYS) this.#removeKey(keyFile, key);
    keyFile.set_string(DESKTOP_GROUP, MetaKey.kind, meta.kind);
    keyFile.set_string(DESKTOP_GROUP, MetaKey.source, meta.source);
    keyFile.set_string(DESKTOP_GROUP, MetaKey.wmClass, meta.wmClass);
    keyFile.set_string(DESKTOP_GROUP, MetaKey.matchType, meta.matchType);
    keyFile.set_integer(DESKTOP_GROUP, MetaKey.score, meta.score);
    keyFile.set_comment(null, null, headerComment(meta));
  }

  fileFor(wmClass: string): Gio.File {
    return this.dir.get_child(`${generatedFileName(wmClass)}${DESKTOP_SUFFIX}`);
  }

  exists(file: Gio.File): Promise<boolean> {
    return fileExists(file);
  }

  async write(target: Gio.File, meta: EntryMetadata): Promise<void> {
    const keyFile = await loadKeyFile(Gio.File.new_for_path(meta.source));
    this.#applyGhostPatch(keyFile, meta);
    await ensureDir(this.dir);
    await saveKeyFile(target, keyFile);
  }

  async list(): Promise<Gio.File[]> {
    const children = await listChildren(this.dir);
    return children.filter((file) =>
      file.get_basename()?.endsWith(DESKTOP_SUFFIX),
    );
  }

  async #readMetadata(file: Gio.File): Promise<EntryMetadata | null> {
    const bytes = await readBytes(file);
    const keyFile = new GLib.KeyFile();
    keyFile.load_from_bytes(bytes, GLib.KeyFileFlags.NONE);

    const legacy = parseLegacyHeader(new TextDecoder("utf-8").decode(bytes));
    const source = this.#getString(keyFile, MetaKey.source) ?? legacy.source;
    // Because old version I need to check every corner for this little fucker
    const wmClass =
      this.#getString(keyFile, MetaKey.wmClass) ??
      this.#getString(keyFile, STARTUP_WM_CLASS_KEY) ??
      file.get_basename()?.replace(/\.desktop$/, "");
    if (!source || !wmClass) return null;

    const score = Number(
      this.#getString(keyFile, MetaKey.score) ?? legacy.score ?? 0,
    );
    return {
      kind: "ghost",
      source,
      wmClass,
      matchType:
        this.#getString(keyFile, MetaKey.matchType) ??
        legacy.matchType ??
        "unknown",
      score: Number.isFinite(score) ? score : 0,
    };
  }

  async sync(): Promise<SyncReport> {
    const report: SyncReport = { synced: 0, skipped: 0, failed: 0, deleted: 0 };

    for (const file of await this.list()) {
      try {
        const meta = await this.#readMetadata(file);
        if (!meta) {
          logger.warn(`No metadata, skipping ${file.get_path()}`);
          report.skipped++;
          continue;
        }

        meta.source = await this.#resolveSource(meta.source);
        if (!(await fileExists(Gio.File.new_for_path(meta.source)))) {
          logger.warn(`Source missing, removing ghost: ${file.get_path()}`);
          await deleteFile(file);
          report.deleted++;
          continue;
        }

        await this.write(file, meta);
        logger.debug(`Synced ${file.get_path()}`);
        report.synced++;
      } catch (err) {
        logger.error(`Failed syncing ${file.get_path()}`, err);
        report.failed++;
      }
    }

    return report;
  }

  // First version could generate a ghost file recursion for that reason it tracks the chain back
  async #resolveSource(source: string): Promise<string> {
    const seen = new Set<string>();
    let current = source;

    while (this.#isInside(current) && !seen.has(current)) {
      seen.add(current);
      const file = Gio.File.new_for_path(current);
      if (!(await fileExists(file))) break;

      const meta = await this.#readMetadata(file);
      if (!meta) break;
      current = meta.source;
    }

    return current;
  }

  #isInside(path: string): boolean {
    return path.startsWith(`${this.dir.get_path()}/`);
  }

  async reset(): Promise<number> {
    let deleted = 0;

    const files = await listChildren(this.dir);

    for (const file of files) {
      try {
        await deleteFile(file);
        deleted++;
      } catch (err) {
        logger.error(`Failed deleting ${file.get_path()}`, err);
      }
    }

    return deleted;
  }
}
