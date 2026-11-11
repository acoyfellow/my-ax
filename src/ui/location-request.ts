import { coarsen, decideLocation, locationToast, type CoarsePosition, type LocationPermission } from "./web/location";

export type LocationDeps = {
  enabled: () => boolean;
  pushSystem: (text: string) => void;
  receipt: (text: string) => void;
};

export type LocationResult = { ok: true; position: CoarsePosition } | { ok: false; reason: string };

async function readPermission(): Promise<LocationPermission> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unsupported";
  try {
    if (!navigator.permissions?.query) return "prompt";
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "prompt";
  }
}

export async function handleLocationRequest(deps: LocationDeps): Promise<LocationResult> {
  const decision = decideLocation({ enabled: deps.enabled(), permission: await readPermission() });
  if (decision.action === "refuse") {
    deps.receipt(`Location refused: ${decision.reason}`);
    return { ok: false, reason: decision.reason };
  }
  return new Promise<LocationResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coarse = coarsen({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        deps.pushSystem(locationToast(coarse));
        deps.receipt(locationToast(coarse));
        resolve({ ok: true, position: coarse });
      },
      (err) => {
        const reason = err && err.message ? err.message : "Location unavailable";
        deps.receipt(`Location failed: ${reason}`);
        resolve({ ok: false, reason });
      },
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 },
    );
  });
}

export function installLocationBridge(target: EventTarget, deps: LocationDeps): () => void {
  const listener = () => {
    void handleLocationRequest(deps).then((detail) => {
      if (typeof CustomEvent !== "undefined") target.dispatchEvent(new CustomEvent("my-ax:location-result", { detail }));
    });
  };
  target.addEventListener("my-ax:location-request", listener);
  return () => target.removeEventListener("my-ax:location-request", listener);
}
