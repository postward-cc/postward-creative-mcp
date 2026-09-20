import { postJson } from "./http.ts";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

/** Well-known ElevenLabs pre-made voice (Rachel). Overridable via `voice`. */
export const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

/** Multilingual TTS. Returns MP3 bytes. */
export async function elevenlabsSpeech(
  key: string,
  input: { text: string; voice?: string },
): Promise<Buffer> {
  const voiceId = input.voice ?? ELEVENLABS_DEFAULT_VOICE;
  const response = await postJson(
    "elevenlabs",
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`,
    { "xi-api-key": key },
    {
      text: input.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    `text-to-speech (voice ${voiceId})`,
  );
  return Buffer.from(await response.arrayBuffer());
}
