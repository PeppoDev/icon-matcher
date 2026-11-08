// Node can't load gi:// modules. src/constants.ts imports GLib and Meta, so
// the tests replace them with the few members the pure code needs.
import { register } from "node:module";

const STUBS = {
  "gi://GLib": "export default { get_user_data_dir: () => '/home/user/.local/share' };",
  "gi://Meta": "export default { WindowType: { NORMAL: 0, DESKTOP: 1, DIALOG: 3, MODAL_DIALOG: 4 } };",
  "gi://GioUnix": "export default { DesktopAppInfo: class DesktopAppInfo {} };",
};

const hooks = `
const STUBS = ${JSON.stringify(STUBS)};
export async function resolve(specifier, context, next) {
  if (specifier in STUBS) {
    return { shortCircuit: true, url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]) };
  }
  return next(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(hooks));
