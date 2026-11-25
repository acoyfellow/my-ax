export const PI_GATEWAY_PROVIDER_ID = "myax-gateway";
export const PI_GOOGLE_GATEWAY_PROVIDER_ID = "myax-gateway-google";

export type PiModelChoice = { provider: string; id: string; label: string };

export const PI_ENGINE_MODEL_CHOICES: readonly PiModelChoice[] = [
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-opus-5-5", label: "Opus 5.5" },
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-opus-5", label: "Opus 5" },
  { provider: PI_GATEWAY_PROVIDER_ID, id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: "gemini-4-neon", label: "Gemini 4 Neon" },
  { provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen" },
  { provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: "gemini-4-argon", label: "Gemini 4 Argon" },
  { provider: PI_GOOGLE_GATEWAY_PROVIDER_ID, id: "gemini-4-carbon", label: "Gemini 4 Carbon" },
  { provider: "cloudflare", id: "@cf/zai-org/glm-5.3", label: "GLM 5.3" },
];
