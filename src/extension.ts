import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

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

  enable() {
    this.#settings = new ExtensionSettings(this.getSettings());
    this.#fixer = new Fixer(new Matcher(), new GhostWriter(new GhostHandler()));
    this.#watcher = new Watcher(this.#fixer);
    this.#watcher.enable();
  }

  disable() {
    this.#watcher?.disable();
    this.#fixer?.reset();
    this.#settings?.reset();

    this.#watcher = null;
    this.#fixer = null;
    this.#settings = null;
  }
}
