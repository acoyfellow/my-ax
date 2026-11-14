export type AlertTone = "default" | "danger";

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: AlertTone;
  typeToConfirm?: string;
};

export type PromptOptions = {
  title: string;
  body?: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  allowEmpty?: boolean;
  multiline?: boolean;
};

export type ToastTone = "info" | "success" | "error";

type PendingConfirm = {
  kind: "confirm";
  id: number;
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
};
type PendingPrompt = {
  kind: "prompt";
  id: number;
  options: PromptOptions;
  resolve: (value: string | null) => void;
};
export type PendingAlert = PendingConfirm | PendingPrompt;
export type Toast = { id: number; text: string; tone: ToastTone };

export const TOAST_MS: Readonly<Record<ToastTone, number>> = {
  info: 3500,
  success: 3500,
  error: 8000,
};

let nextId = 0;

export type AlertState = { queue: PendingAlert[]; toasts: Toast[] };

export function createAlerts(alertState: AlertState) {
  function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      alertState.queue.push({
        kind: "confirm",
        id: ++nextId,
        options,
        resolve,
      });
    });
  }

  function promptDialog(options: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      alertState.queue.push({ kind: "prompt", id: ++nextId, options, resolve });
    });
  }

  function settleCurrent(result: boolean | string | null): void {
    const current = alertState.queue.shift();
    if (!current) return;
    if (current.kind === "confirm") current.resolve(result === true);
    else current.resolve(typeof result === "string" ? result : null);
  }

  function notify(text: string, tone: ToastTone = "info"): number {
    const id = ++nextId;
    alertState.toasts.push({ id, text, tone });
    if (typeof setTimeout === "function")
      setTimeout(() => dismissToast(id), TOAST_MS[tone]);
    return id;
  }

  function dismissToast(id: number): void {
    const index = alertState.toasts.findIndex((toast) => toast.id === id);
    if (index >= 0) alertState.toasts.splice(index, 1);
  }
  return { confirmDialog, promptDialog, settleCurrent, notify, dismissToast };
}

export function confirmAllowed(
  options: ConfirmOptions,
  typed: string,
): boolean {
  return !options.typeToConfirm || typed.trim() === options.typeToConfirm;
}

export function promptAllowed(options: PromptOptions, value: string): boolean {
  return options.allowEmpty === true || value.trim().length > 0;
}
