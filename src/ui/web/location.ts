export type RawPosition = { latitude: number; longitude: number; accuracy: number };

export type CoarsePosition = { latitude: number; longitude: number; accuracyMeters: number };

export function coarsen(position: RawPosition): CoarsePosition {
  return {
    latitude: Math.round(position.latitude * 100) / 100,
    longitude: Math.round(position.longitude * 100) / 100,
    accuracyMeters: Math.max(1000, Math.round(position.accuracy)),
  };
}

export type LocationPermission = "granted" | "prompt" | "denied" | "unsupported";

export type LocationDecision = { action: "read" | "refuse"; reason: string };

export function decideLocation(input: { enabled: boolean; permission: LocationPermission }): LocationDecision {
  if (input.enabled && (input.permission === "granted" || input.permission === "prompt")) {
    return { action: "read", reason: "" };
  }
  let reason = "";
  if (!input.enabled) {
    reason = "Location disabled";
  } else if (input.permission === "denied") {
    reason = "Permission denied";
  } else if (input.permission === "unsupported") {
    reason = "Not supported";
  }
  return { action: "refuse", reason };
}

export function locationToast(position: CoarsePosition): string {
  const latStr = position.latitude.toFixed(2);
  const lonStr = position.longitude.toFixed(2);
  const kmStr = Math.round(position.accuracyMeters / 1000);
  return `Shared your location (${latStr}, ${lonStr}, about ${kmStr} km)`;
}
