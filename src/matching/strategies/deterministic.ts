import { DETERMINISTIC_SCORE } from "../../constants.js";
import {
  AppCatalog,
  MappedWindow,
  MatchResult,
  MatchStrategy,
} from "../../types.js";

export function deterministicLookups(win: MappedWindow): [string, string[]][] {
  const { wmClass, appId, title } = win;
  const lookups: [string, string[]][] = [];

  if (title) {
    lookups.push([
      "title",
      [`${title}.desktop`, `${title.toLowerCase().trim()}.desktop`],
    ]);
  }
  if (appId) {
    lookups.push(["app id", [`${appId.toLowerCase().trim()}.desktop`]]);
  }
  if (wmClass) {
    lookups.push([
      "wm class",
      [`${wmClass}.desktop`, `${wmClass.toLowerCase().trim()}.desktop`],
    ]);
  }

  return lookups;
}

export class DeterministicStrategy implements MatchStrategy {
  readonly name = "deterministic" as const;

  match(win: MappedWindow, catalog: AppCatalog): MatchResult | null {
    for (const [source, ids] of deterministicLookups(win)) {
      for (const id of ids) {
        const app = catalog.lookup(id);

        if (!app || !app.hasIcon || app.isGenerated) continue;

        return {
          kind: "existing",
          app,
          matchType: "deterministic",
          score: DETERMINISTIC_SCORE,
          runnerUpScore: 0,
          reason: `${source} = desktop id`,
        };
      }
    }

    return null;
  }
}
