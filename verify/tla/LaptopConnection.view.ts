type Socket = { gen: number; open: boolean };

type Vars = { generation: number; catalog: number; sockets: Socket[]; nextGen: number };

export const title = "Your laptop's connection to my.ax";

export const state = (v: Vars) => {
  if (v.generation === 0) return v.sockets.length ? "Offline, an old socket is closing" : "Offline";
  const current = v.catalog === v.generation ? "Online, tools ready" : "Online, waiting for tools";
  const stale = v.sockets.some((s) => s.gen !== v.generation);
  return stale ? `${current} (old socket closing)` : current;
};

export const group = (v: Vars) => (v.generation === 0 ? "offline" : v.catalog === v.generation ? "ready" : "connecting");

export const colors = { offline: "tan", connecting: "yellow", ready: "teal" };

export const step = (action: string, from: Vars, to: Vars) => {
  if (action === "LaptopConnects") return from.generation === 0 ? "the laptop connects" : "the laptop reconnects (old socket replaced)";
  if (action === "SomeLaptopSaysHello") return to.catalog !== from.catalog ? "the laptop sends its tools" : "an old socket sends tools [ignored]";
  if (action === "SomeSocketCloses") return to.generation !== from.generation ? "the laptop disconnects" : "an old socket finishes closing";
  return null;
};
