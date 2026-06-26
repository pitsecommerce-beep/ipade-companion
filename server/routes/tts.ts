import { Router } from "express";

const router = Router();

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — clear, natural female voice

router.post("/", async (req, res) => {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "ELEVENLABS_API_KEY no configurada." });
      return;
    }

    const { text } = req.body as { text?: string };
    if (!text?.trim()) {
      res.status(400).json({ error: "Texto vacío." });
      return;
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

    const ttsRes = await fetch(`${ELEVENLABS_URL}/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.4,
        },
      }),
    });

    if (!ttsRes.ok) {
      const detail = await ttsRes.text();
      console.error(`[tts] ElevenLabs ${ttsRes.status}: ${detail.slice(0, 500)}`);
      res.status(502).json({
        error: `ElevenLabs error (${ttsRes.status}): ${detail.slice(0, 300)}`,
      });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    const arrayBuf = await ttsRes.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err) {
    console.error("[tts] Error:", err);
    res.status(500).json({
      error: `Error TTS: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

router.get("/check", async (_req, res) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.json({ ok: false, reason: "ELEVENLABS_API_KEY no configurada." });
    return;
  }

  try {
    const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;

    const [userRes, voiceRes] = await Promise.all([
      fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": apiKey },
      }),
      fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
        headers: { "xi-api-key": apiKey },
      }),
    ]);

    const user = userRes.ok ? await userRes.json() as Record<string, unknown> : null;
    const voice = voiceRes.ok ? await voiceRes.json() as Record<string, unknown> : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sub = (user as any)?.subscription;

    res.json({
      ok: userRes.ok && voiceRes.ok,
      api_key_valid: userRes.ok,
      voice_id: voiceId,
      voice_name: voice ? (voice as Record<string, unknown>).name : `ERROR ${voiceRes.status}`,
      character_limit: sub?.character_limit ?? "?",
      character_count: sub?.character_count ?? "?",
      tier: sub?.tier ?? "?",
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

export default router;
