/** Game id of a X11 Proton window (`steam_app_<id>`), null otherwise */
export function steamGameIdFromWmClass(wmClass: string): string | null {
  const STEAM_APP_WM_CLASS = /^steam_app_(\d+)$/i;
  return wmClass.match(STEAM_APP_WM_CLASS)?.[1] ?? null;
}

// The id must not continue with more digits: game 480 is not game 4800
export function launchesSteamGame(
  commandline: string,
  gameId: string,
): boolean {
  return new RegExp(`steam://rungameid/${gameId}(?!\\d)`).test(commandline);
}
