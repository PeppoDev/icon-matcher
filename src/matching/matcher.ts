import { DeterministicStrategy } from "./strategies/deterministic.js";
import { HeuristicStrategy } from "./strategies/heuristic.js";
import type {
  AppCatalog,
  MatchResult,
  MatchStrategy,
  MappedWindow,
} from "../types.js";

export class Matcher {
  constructor(private readonly strategies: readonly MatchStrategy[]) {}

  match(win: MappedWindow, catalog: AppCatalog): MatchResult | null {
    for (const strategy of this.strategies) {
      const result = strategy.match(win, catalog);
      if (result) return result;
    }
    return null;
  }
}

export function createDefaultMatcher(): Matcher {
  return new Matcher([new DeterministicStrategy(), new HeuristicStrategy()]);
}
