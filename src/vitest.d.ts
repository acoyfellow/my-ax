declare module "vitest" {
  export const describe: (name: string, run: () => void) => void;
  export const it: (name: string, run: () => void | Promise<void>) => void;
  export const test: (name: string, run: () => void | Promise<void>) => void;
  export const expect: (value: unknown) => any;
}
