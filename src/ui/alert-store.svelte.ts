import { createAlerts, type AlertState } from "./alert-queue";

export { confirmAllowed, promptAllowed } from "./alert-queue";
export type { ConfirmOptions, PromptOptions, ToastTone } from "./alert-queue";

export const alertState = $state<AlertState>({ queue: [], toasts: [] });

export const { confirmDialog, promptDialog, settleCurrent, notify, dismissToast } = createAlerts(alertState);
