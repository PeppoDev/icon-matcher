import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { AutoSync } from "./core/autoSync.js";
import { Fixer } from "./core/fixer.js";
import { ExtensionSettings } from "./core/settings.js";
import { Watcher } from "./core/watcher.js";
import { GhostHandler } from "./entries/ghostHandler.js";
import { GhostWriter } from "./entries/ghostWriter.js";
import { Matcher } from "./matching/matcher.js";
import type { Nullable } from "./types.js";

export default class IconMatcherExtension extends Extension {
  #settings: Nullable<ExtensionSettings> = null;
  #fixer: Nullable<Fixer> = null;
  #watcher: Nullable<Watcher> = null;
  #autoSync: Nullable<AutoSync> = null;

  enable() {
    this.#settings = new ExtensionSettings(this.getSettings());
    const store = new GhostHandler();
    this.#fixer = new Fixer(new Matcher(), new GhostWriter(store));
    this.#watcher = new Watcher(this.#fixer);
    this.#watcher.enable();
    this.#autoSync = new AutoSync(store, this.#settings);
    this.#autoSync.enable();
  }

  disable() {
    this.#autoSync?.disable();
    this.#watcher?.disable();
    this.#fixer?.reset();
    this.#settings?.reset();

    this.#autoSync = null;
    this.#watcher = null;
    this.#fixer = null;
    this.#settings = null;
  }
}
