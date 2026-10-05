export const WORKSPACE_ALIAS_PATH = "/workspace";

export function workspaceInitCommand(home: string, readyMarker: string): string {
  const alias = WORKSPACE_ALIAS_PATH;
  return [
    "set -e",
    `mkdir -p ${home}/.config ${home}/.my-ax/conversations`,
    `if [ -d ${alias} ] && [ ! -L ${alias} ]; then cp -an ${alias}/. ${home}/ 2>/dev/null || true; rm -rf ${alias}; fi`,
    `if [ ! -L ${alias} ]; then ln -s ${home} ${alias}; fi`,
    `test "$(cd ${alias} && pwd -P)" = "$(cd ${home} && pwd -P)"`,
    `touch ${readyMarker}`,
  ].join("; ");
}
