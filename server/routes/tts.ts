import { Router } from "express";

const router = Router();

const DEEPGRAM_URL = "https://api.deepgram.com/v1/speak";
const DEFAULT_MODEL = "aura-asteria-en";

router.post("/", async (req, res) => {
  try {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "DEEPGRAM_API_KEY no configurada." });
      return;
    }

    const { text } = req.body as { text?: string };
    if (!text?.trim()) {
      res.status(400).json({ error: "Texto vacío." });
      return;
    }

    const model = process.env.DEEPGRAM_VOICE_MODEL || DEFAULT_MODEL;

    const ttsRes = await fetch(`${DEEPGRAM_URL}?model=${model}&encoding=mp3`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!ttsRes.ok) {
      const detail = await ttsRes.text();
      console.error(`[tts] Deepgram ${ttsRes.status}: ${detail.slice(0, 500)}`);
      res.status(502).json({
        error: `Deepgram error (${ttsRes.status}): ${detail.slice(0, 300)}`,
      });
      return;
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Transfer-Encoding", "chunked");

    if (!ttsRes.body) {
      const arrayBuf = await ttsRes.arrayBuffer();
      res.send(Buffer.from(arrayBuf));
      return;
    }

    const reader = (ttsRes.body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done: eof, value } = await reader.read();
        if (eof) break;
        res.write(value);
      }
      res.end();
    } catch {
      res.end();
    }
  } catch (err) {
    console.error("[tts] Error:", err);
    res.status(500).json({
      error: `Error TTS: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

router.get("/check", async (_req, res) => {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    res.json({ ok: false, reason: "DEEPGRAM_API_KEY no configurada." });
    return;
  }

  try {
    const model = process.env.DEEPGRAM_VOICE_MODEL || DEFAULT_MODEL;

    const testRes = await fetch(`${DEEPGRAM_URL}?model=${model}&encoding=mp3`, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Prueba." }),
    });

    if (!testRes.ok) {
      const detail = await testRes.text();
      res.json({
        ok: false,
        api_key_valid: testRes.status !== 401 && testRes.status !== 403,
        model,
        reason: `Deepgram ${testRes.status}: ${detail.slice(0, 300)}`,
      });
      return;
    }

    await testRes.arrayBuffer();

    res.json({
      ok: true,
      api_key_valid: true,
      model,
    });
  } catch (err) {
    res.json({ ok: false, reason: String(err) });
  }
});

export default router;
