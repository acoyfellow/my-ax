import { defineExtension, section } from "@earendil-works/pi-durable";

export function convoStyleExtension(load: () => Promise<string>) {
  return defineExtension({ name: "myax.convo-style", sections: [section("convo-style", async () => (await load()).trim() || undefined)] });
}
