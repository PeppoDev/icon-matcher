import { USER_APP_DIR } from "./contants.js";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

// TODO: use a global logger function
function updateDesktopDatabase() {
  try {
    const proc = Gio.Subprocess.new(
      ["update-desktop-database", USER_APP_DIR],
      Gio.SubprocessFlags.NONE,
    );

    proc.wait_async(null, (_proc, result) => {
      _proc?.wait_finish(result);
      console.log(
        "[IconMatcher] update-desktop-database completed — fix is active",
      );
    });
  } catch (err) {
    console.error("[IconMatcher] Could not launch update-desktop-database");
  }
}

// TODO: Test it more, still experimental
async function syncDesktopFiles(folderPath: string): Promise<void> {
  const dir = Gio.File.new_for_path(folderPath);
  const enumerator = await enumerateChildrenAsync(dir);

  let info: Gio.FileInfo | null;

  while ((info = enumerator.next_file(null))) {
    const name = info.get_name();

    if (!name.endsWith(".desktop")) continue;

    const generatedFile = dir.get_child(name);

    const generatedPath = generatedFile.get_path() ?? name;

    try {
      const generatedContent = await loadContentsAsync(generatedFile);
      const sourceMatch = generatedContent.match(/^# Source:\s*(.+)$/m);

      if (!sourceMatch) continue;
      const sourcePath = sourceMatch[1].trim();

      if (!GLib.file_test(sourcePath, GLib.FileTest.EXISTS)) {
        console.warn(` [IconMatcher] Source missing: ${sourcePath}`);

        continue;
      }

      const sourceFile = Gio.File.new_for_path(sourcePath);

      const sourceContent = await loadContentsAsync(sourceFile);

      const startupLine =
        generatedContent.match(/^StartupWMClass=.*$/m)?.[0] ?? null;

      const noDisplayLine =
        generatedContent.match(/^NoDisplay=.*$/m)?.[0] ?? null;

      const comments = generatedContent
        .split("\n")
        .filter((line) => line.startsWith("#"))
        .join("\n");

      const cleanedSource = sourceContent
        .split("\n")
        .filter(
          (line) =>
            !line.startsWith("StartupWMClass=") &&
            !line.startsWith("NoDisplay="),
        )
        .join("\n");

      const finalLines: string[] = [];

      if (comments) finalLines.push(comments);

      finalLines.push("");
      finalLines.push(cleanedSource.trimEnd());

      if (startupLine) finalLines.push(startupLine);

      if (noDisplayLine) finalLines.push(noDisplayLine);

      finalLines.push("");

      await replaceContentsAsync(generatedFile, finalLines.join("\n"));

      console.debug(`[IconMatcher] Synced ${generatedPath}`);
    } catch (e) {
      console.error(`[IconMatcher] Failed syncing ${generatedPath}`, e);
    }
  }

  enumerator.close(null);
}

function loadContentsAsync(file: Gio.File): Promise<string> {
  return new Promise((resolve, reject) => {
    file.load_contents_async(null, (_obj, res) => {
      try {
        const [, contents] = file.load_contents_finish(res);

        resolve(new TextDecoder().decode(contents));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function replaceContentsAsync(file: Gio.File, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    file.replace_contents_async(
      new TextEncoder().encode(content),
      null,
      false,
      Gio.FileCreateFlags.REPLACE_DESTINATION,
      null,
      (_obj, res) => {
        try {
          file.replace_contents_finish(res);
          resolve();
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

function enumerateChildrenAsync(dir: Gio.File): Promise<Gio.FileEnumerator> {
  return new Promise((resolve, reject) => {
    dir.enumerate_children_async(
      "standard::type",
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      null,
      (_obj, res) => {
        try {
          resolve(dir.enumerate_children_finish(res));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}

export { updateDesktopDatabase, syncDesktopFiles };
