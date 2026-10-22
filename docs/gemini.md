# Google voice and hybrid reasoning

See [setup](../SETUP.md) for installation and configuration.

Google voice is a core path in every provider mode:
microphone → Google Live transcription → local intent matching → reasoning/local execution → Google TTS → playback.

The sidebar uses dedicated transcription (`gemini-3.5-transcribe-live`) rather than letting a conversational Live model answer independently. Google TTS (`gemini-3.8-flash-lite-tts`) receives the actual final answer from Gemma or Groq.

`MODEL` controls reasoning and vision only. `BOTH` prefers Groq, `GOOGLE` uses Gemma routing, and `GROQ` never sends reasoning to Google. Voice remains Google-powered.

Legacy conversational Live classes remain available for compatibility but are not the sidebar microphone implementation. The previous Windows offline speech implementation is no longer used by the sidebar.
