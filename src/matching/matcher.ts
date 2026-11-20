import type {
  AppCatalog,
  MappedWindow,
  MatchResult,
  MatchStrategy,
  Nullable,
} from "../types.js";
import { DeterministicStrategy } from "./strategies/deterministic.js";
import { HeuristicStrategy } from "./strategies/heuristic.js";

export class Matcher {
  #strategies: MatchStrategy[] = [];
  constructor() {
    this.#strategies = [new DeterministicStrategy(), new HeuristicStrategy()];
  }

  match(win: MappedWindow, catalog: AppCatalog): Nullable<MatchResult> {
    for (const strategy of this.#strategies) {
      const result = strategy.match(win, catalog);
      if (result) return result;
    }
    return null;
  }
}
