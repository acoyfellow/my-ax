import { defineExtension, section } from "@earendil-works/pi-durable";

export function ownerInstructionsExtension(load: () => Promise<string>) {
  return defineExtension({ name: "myax.owner", sections: [section("owner-instructions", async () => (await load()).trim() || undefined)] });
}
