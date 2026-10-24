export const WORKSPACE_ALIAS_PATH = "/workspace";
export const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

export function readyMarkerCheckCommand(readyMarker: string, bootIdPath = BOOT_ID_PATH): string {
  return `test -f ${readyMarker} && test "$(cat ${readyMarker})" = "$(cat ${bootIdPath})"`;
}

export function workspaceInitCommand(home: string, readyMarker: string, bootIdPath = BOOT_ID_PATH): string {
  const alias = WORKSPACE_ALIAS_PATH;
  return [
    "set -e",
    `mkdir -p ${home}/.config ${home}/.my-ax/conversations`,
    `if [ -d ${alias} ] && [ ! -L ${alias} ]; then cp -an ${alias}/. ${home}/ 2>/dev/null || true; rm -rf ${alias}; fi`,
    `if [ ! -L ${alias} ]; then ln -s ${home} ${alias}; fi`,
    `test "$(cd ${alias} && pwd -P)" = "$(cd ${home} && pwd -P)"`,
    `cat ${bootIdPath} > ${readyMarker}`,
  ].join("; ");
}
