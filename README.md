# Orbit

Orbit is a small, browser-based AI chat app. It uses Pollinations Classic's free `openai-fast` model (GPT-OSS 20B), so you do not need to create an account or provide an API key.

## Run locally

From this folder, start a static web server:

```powershell
py -m http.server 8000
```

Then open <http://localhost:8000>. A local server is needed because browsers restrict network requests from pages opened directly as files.

## Features

- Streaming AI chat and conversation history saved in this browser.
- Live weather lookup via Open-Meteo (no API key); ask about weather for a named city, or allow browser location access.
- An approximate active-chat context meter showing estimated use and remaining room against the GPT-OSS 20B model's [131,072-token context window](https://huggingface.co/openai/gpt-oss-20b/blob/main/config.json); 1,200 tokens are reserved for a reply.
- Attach up to five text files (up to 1 MB each) or PDFs (up to 8 MB each).
- PDF text is extracted in the browser with PDF.js; scanned/image-only PDFs are not supported.
- Messages and extracted attachment text are sent to Pollinations. Weather questions are answered directly from Open-Meteo; the chosen city or browser-approved location is sent to Open-Meteo. Avoid submitting sensitive information.

## Free API limits

The anonymous Pollinations endpoint does not require login or an API key. Its documented anonymous limit is one text request every 30 seconds per IP address; people sharing a network may share that limit. The service can change its availability or limits. Orbit displays a retry message if the service rejects a request for rate limiting.

The context meter estimates token counts from text length because the anonymous API does not return token usage or remaining quota. Actual tokenization and Pollinations' own request limits may differ; the 30-second request limit is separate from the model context window.

This model is text-only; image uploads are not supported. An internet connection is needed for the AI service, Google Fonts, and PDF.js (loaded from jsDelivr when a PDF is attached).

Weather requests use the free Open-Meteo geocoding and forecast APIs. Include a city or town for best results; if you omit it, Orbit asks the browser for permission to use your current location.
