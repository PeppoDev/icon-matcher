import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { ExtensionSettings } from "./core/settings.js";
import { GeneratedEntryStore } from "./entries/GeneratedEntryStore.js";
import { GhostEntryWriter } from "./entries/GhostEntryWriter.js";
import { Fixer } from "./core/fixer.js";
import { createDefaultMatcher } from "./matching/matcher.js";
import { Watcher } from "./core/watcher.js";
import { AppIndexer } from "./core/appIndexer.js";

export default class IconMatcherExtension extends Extension {
  #settings: ExtensionSettings | null = null;
  #fixer: Fixer | null = null;
  #watcher: Watcher | null = null;

  enable() {
    this.#settings = new ExtensionSettings(this.getSettings());
    this.#fixer = new Fixer(
      createDefaultMatcher(),
      new GhostEntryWriter(new GeneratedEntryStore()),
    );
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
