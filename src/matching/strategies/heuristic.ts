import {
  MIN_MATCH_SCORE,
  MIN_STRING_LENGTH,
  STEAM_EXEC_SCORE,
} from "../../constants.js";
import { toHeuristicWindow } from "../../mappers/window.js";
import type {
  AppCatalog,
  HeurisctWindow,
  MappedApp,
  MappedWindow,
  MatchResult,
  MatchStrategy,
} from "../../types.js";
import { launchesSteamGame } from "../../utils/steam.js";

interface ScoreRule {
  id: string;
  score: number;
  applies(win: HeurisctWindow, app: MappedApp): boolean;
}

export interface Score {
  score: number;
  rule: string;
}

const longEnough = (str: string) => str.length > MIN_STRING_LENGTH;

// Last segments of dns-like ids that say nothing about the app, e.g.
// org.gnome.seahorse.Application would match the "GTK Application" wm class
const GENERIC_SHORT_IDS = new Set([
  "application",
  "app",
  "desktop",
  "client",
  "launcher",
  "main",
  "gui",
]);

const WM_CLASS_RULES: ScoreRule[] = [
  { id: "wm = desktop id", score: 93, applies: (w, a) => a.desktopId === w.wm },
  {
    id: "desktop id contains wm",
    score: 80,
    applies: (w, a) => a.desktopId.includes(w.wm) && longEnough(w.wm),
  },
  {
    id: "wm contains desktop id",
    score: 70,
    applies: (w, a) => w.wm.includes(a.desktopId) && longEnough(a.desktopId),
  },
  {
    id: "wm contains short desktop id",
    score: 66,
    applies: (w, a) =>
      !!a.shortDesktopId &&
      !GENERIC_SHORT_IDS.has(a.shortDesktopId) &&
      w.wm.includes(a.shortDesktopId) &&
      longEnough(a.shortDesktopId),
  },
  { id: "wm = name", score: 85, applies: (w, a) => a.nameLower === w.wm },
  {
    id: "name contains wm",
    score: 60,
    applies: (w, a) => a.nameLower.includes(w.wm) && longEnough(w.wm),
  },
  {
    id: "wm contains name",
    score: 55,
    applies: (w, a) => w.wm.includes(a.nameLower) && longEnough(a.nameLower),
  },
];

const APP_ID_RULES: ScoreRule[] = [
  {
    id: "desktop id contains app id",
    score: 75,
    applies: (w, a) => a.desktopId.includes(w.appId) && longEnough(w.appId),
  },
];

// Window title match, seems to be more effective than the others
// careful about inclusions
const TITLE_RULES: ScoreRule[] = [
  {
    id: "title = desktop id",
    score: 98,
    applies: (w, a) => w.title === a.desktopNormalized,
  },
  {
    id: "title = name",
    score: 95,
    applies: (w, a) => w.title === a.nameNormalized,
  },
  {
    id: "title = short desktop id",
    score: 94,
    applies: (w, a) => w.title === a.shortIdNormalized,
  },
  {
    id: "name contains title",
    score: 65,
    applies: (w, a) => a.nameNormalized.includes(w.title),
  },
  {
    id: "title contains desktop id",
    score: 68,
    // avoid short ids (vim, nm, an empty one...) contained in random titles
    applies: (w, a) =>
      longEnough(a.desktopNormalized) && w.title.includes(a.desktopNormalized),
  },
];

function bestRule(
  rules: ScoreRule[],
  win: HeurisctWindow,
  app: MappedApp,
  current: Score,
) {
  for (const rule of rules) {
    if (rule.score > current.score && rule.applies(win, app)) {
      current = { score: rule.score, rule: rule.id };
    }
  }
  return current;
}

// Prevent sub process ex: steam_app_1234 being matched to steam.desktop
function isSubProcessOf(win: HeurisctWindow, app: MappedApp): boolean {
  if (!win.wm) return false;
  return [app.desktopId, app.shortDesktopId].some(
    (id) => win.wm.startsWith(`${id}_`) || win.wm.startsWith(`${id}-`),
  );
}

export function scoreCandidate(win: HeurisctWindow, app: MappedApp): Score {
  if (win.steamGameId && launchesSteamGame(app.commandline, win.steamGameId))
    return { score: STEAM_EXEC_SCORE, rule: "steam exec" };

  if (isSubProcessOf(win, app)) return { score: 0, rule: "sub process" };

  let score: Score = { score: 0, rule: "none" };
  if (win.wm) score = bestRule(WM_CLASS_RULES, win, app, score);
  if (win.appId) score = bestRule(APP_ID_RULES, win, app, score);
  if (longEnough(win.title)) score = bestRule(TITLE_RULES, win, app, score);
  return score;
}

export class HeuristicStrategy implements MatchStrategy {
  readonly name = "heuristic" as const;

  match(win: MappedWindow, catalog: AppCatalog): MatchResult | null {
    const prepared = toHeuristicWindow(win);
    let best: { app: MappedApp; score: Score } | null = null;
    let runnerUpScore = 0;

    for (const app of catalog.all()) {
      if (!app.hasIcon || app.isGenerated) continue;

      const score = scoreCandidate(prepared, app);
      if (score.score > (best?.score.score ?? 0)) {
        runnerUpScore = best?.score.score ?? 0;
        best = { app, score };
      } else if (score.score > runnerUpScore) {
        runnerUpScore = score.score;
      }
    }

    if (!best || best.score.score < MIN_MATCH_SCORE) return null;

    return {
      kind: "existing",
      app: best.app,
      matchType: "heuristic",
      score: best.score.score,
      runnerUpScore,
      reason: best.score.rule,
    };
  }
}
