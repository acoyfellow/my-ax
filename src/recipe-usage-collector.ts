export const RECIPES_USED_THIS_TURN_MAX_ENTRIES = 8;
const RECIPES_USED_THIS_TURN_MAX_OMITTED = 1_000_000;

export class RecipeUsageCollector {
  #entries: unknown[] = [];
  #omitted = 0;

  add(entry: unknown) {
    if (this.#entries.length < RECIPES_USED_THIS_TURN_MAX_ENTRIES) {
      this.#entries.push(entry);
      return;
    }
    this.#omitted = Math.min(RECIPES_USED_THIS_TURN_MAX_OMITTED, this.#omitted + 1);
  }

  take(): unknown[] {
    const entries = this.#entries;
    this.#entries = [];
    if (this.#omitted > 0) entries.push({ kind: "truncated", omitted: this.#omitted });
    this.#omitted = 0;
    return entries;
  }
}
