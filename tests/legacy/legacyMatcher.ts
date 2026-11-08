// Verbatim port of the matching code from src/extension.ts before the
// refactor (commit 0bf07e4). Used as a reference to prove the new matcher keeps
// the same behavior, except for the documented fixes. Do not "fix" this file.

import type { RawAppInfo } from "../../src/mappers/app.js";

const MIN_MATCH_SCORE = 50;
const MIN_STRING_LENGTH = 3;
const FALLBACK_ICON = "application-x-executable";

export interface LegacyResult {
  id: string;
  score: number;
  matchType: "deterministic" | "heuristic";
}

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSteamXorgGame(app: RawAppInfo, wmClass: string): boolean {
  const steamMatch = wmClass.match(/^steam_app_(\d+)$/i);
  if (!steamMatch) return false;

  const gameId = steamMatch[1];
  const info = app.commandline;

  if (!info) return false;
  return info.includes(`steam://rungameid/${gameId}`);
}

export function legacyScoreCandidate(
  app: RawAppInfo,
  wm: string,
  appId: string,
  title: string,
): number {
  if (isSteamXorgGame(app, wm)) {
    return 99;
  }

  const desktopId = (app.id ?? "").toLowerCase().replace(/\.desktop$/, "");
  const appName = (app.name ?? "").toLowerCase();

  const shortDesktopId = desktopId.split(".").pop() ?? "";

  if (
    wm &&
    (wm.startsWith(`${desktopId}_`) ||
      wm.startsWith(`${shortDesktopId}_`) ||
      wm.startsWith(`${desktopId}-`) ||
      wm.startsWith(`${shortDesktopId}-`))
  )
    return 0;

  let score = 0;

  if (wm) {
    if (desktopId === wm) score = Math.max(score, 93);
    if (desktopId.includes(wm) && wm.length > MIN_STRING_LENGTH)
      score = Math.max(score, 80);
    if (wm.includes(desktopId) && desktopId.length > MIN_STRING_LENGTH)
      score = Math.max(score, 70);
    if (
      shortDesktopId &&
      wm.includes(shortDesktopId) &&
      shortDesktopId.length > MIN_STRING_LENGTH
    )
      score = Math.max(score, 66);
    if (appName === wm) score = Math.max(score, 85);
    if (appName.includes(wm) && wm.length > MIN_STRING_LENGTH)
      score = Math.max(score, 60);
    if (wm.includes(appName) && appName.length > MIN_STRING_LENGTH)
      score = Math.max(score, 55);
  }

  if (appId) {
    if (desktopId.includes(appId) && appId.length > MIN_STRING_LENGTH)
      score = Math.max(score, 75);
  }

  const titleNormalized = normalize(title);
  const desktopNormalized = normalize(desktopId);
  const appNameNormalized = normalize(appName);
  const shortIdNormalized = normalize(shortDesktopId);

  if (titleNormalized && titleNormalized.length > MIN_STRING_LENGTH) {
    if (titleNormalized === desktopNormalized) score = Math.max(score, 98);
    if (titleNormalized === appNameNormalized) score = Math.max(score, 95);
    if (titleNormalized === shortIdNormalized) score = Math.max(score, 94);

    if (appNameNormalized.includes(titleNormalized))
      score = Math.max(score, 65);
    if (titleNormalized.includes(desktopNormalized))
      score = Math.max(score, 68);
  }

  return score;
}

function legacyDeterministic(
  apps: readonly RawAppInfo[],
  wmClass: string,
  appId: string,
  title: string,
): LegacyResult | null {
  const lookup = (values: string[]) => {
    for (const id of values) {
      const app = apps.find((a) => a.id === id);
      if (app) return app;
    }
  };

  const wmLower = wmClass.toLowerCase().trim();
  const appLower = appId.toLowerCase().trim();
  const titleLower = title.toLowerCase().trim();

  let app: RawAppInfo | undefined;
  if (title) {
    app = lookup([`${title}.desktop`, `${titleLower}.desktop`]);
  } else if (appId) {
    app = lookup([`${appLower}.desktop`]);
  } else if (wmClass) {
    app = lookup([`${wmClass}.desktop`, `${wmLower}.desktop`]);
  }

  return app ? { id: app.id, score: 100, matchType: "deterministic" } : null;
}

function legacyHeuristic(
  apps: readonly RawAppInfo[],
  wmClass: string,
  appId: string,
  title: string,
): LegacyResult | null {
  let best: RawAppInfo | null = null;
  let bestScore = 0;

  for (const app of apps) {
    const icon = app.icon;
    if (!icon || icon === FALLBACK_ICON) continue;

    const score = legacyScoreCandidate(app, wmClass, appId, title);
    if (score > bestScore) {
      bestScore = score;
      best = app;
    }
  }

  if (bestScore >= MIN_MATCH_SCORE && best) {
    return { id: best.id, score: bestScore, matchType: "heuristic" };
  }
  return null;
}

export function legacyFindBestCandidate(
  apps: readonly RawAppInfo[],
  wmClass: string,
  appId: string,
  title: string,
): LegacyResult | null {
  return (
    legacyDeterministic(apps, wmClass, appId, title) ??
    legacyHeuristic(apps, wmClass, appId, title)
  );
}

export function legacyIsBlackListed(
  patterns: readonly string[],
  wmClass: string,
): boolean {
  const wmLower = wmClass.toLowerCase();

  if (!wmLower || wmLower.length < MIN_STRING_LENGTH) return false;

  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();
    const startsWithWildcard = lowerPattern.startsWith("*");
    const endsWithWildcard = lowerPattern.endsWith("*");
    const term = lowerPattern.replace(/^\*|\*$/g, "");
    let matched = false;

    if (startsWithWildcard && endsWithWildcard) {
      matched = wmLower.includes(term);
    } else if (startsWithWildcard) {
      matched = wmLower.endsWith(term);
    } else if (endsWithWildcard) {
      matched = wmLower.startsWith(term);
    } else {
      matched = wmLower === term;
    }

    if (matched) return true;
  }

  return false;
}
