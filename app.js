const CHAT_API_URL = "https://text.pollinations.ai/openai";
const CHAT_STORAGE_KEY = "orbit.chat-history.v1";
const CHAT_MODEL_ID = "openai-fast";
const MODEL_CONTEXT_LIMIT = 131072;
const MAX_RESPONSE_TOKENS = 1200;
const SYSTEM_PROMPT = "You are Orbit, a helpful assistant. Give clear, accurate answers, explain your reasoning when it helps, and say when you are unsure.";
const WEATHER_CODE_DESCRIPTIONS = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "freezing fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with light hail",
  99: "thunderstorm with heavy hail",
};
const MAX_FILES = 5;
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const MAX_TEXT_FILE_SIZE = 1024 * 1024;
const MAX_ATTACHMENT_CONTEXT = 10000;

const elements = {
  sidebar: document.querySelector("#sidebar"),
  sidebarScrim: document.querySelector("#sidebarScrim"),
  chatList: document.querySelector("#chatList"),
  conversation: document.querySelector("#conversation"),
  welcome: document.querySelector("#welcome"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  fileInput: document.querySelector("#fileInput"),
  attachmentList: document.querySelector("#attachmentList"),
  tokenUsage: document.querySelector("#tokenUsage"),
  tokenMeter: document.querySelector("#tokenMeter"),
  tokenUsageLabel: document.querySelector("#tokenUsageLabel"),
  tokenAvailable: document.querySelector("#tokenAvailable"),
  status: document.querySelector("#connectionStatus"),
  statusText: document.querySelector("#statusText"),
  modelBadge: document.querySelector("#modelBadge"),
  settingsModal: document.querySelector("#settingsModal"),
  toast: document.querySelector("#toast"),
};

let chats = [];
let activeChatId = null;
let pendingFiles = [];
let activeController = null;
let toastTimeout;
let pdfJsPromise;

const textExtensions = new Set([
  "txt", "md", "csv", "json", "xml", "yaml", "yml", "html", "css", "js",
  "ts", "py", "java", "c", "cpp", "h", "sql", "log", "sh", "rs", "go",
  "php", "rb", "jsx", "tsx", "toml",
]);

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function markdownInline(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}

function markdownToHtml(markdown) {
  const chunks = String(markdown).split(/```([^\n]*)\n([\s\S]*?)```/g);
  let html = "";
  for (let index = 0; index < chunks.length; index += 3) {
    const text = chunks[index] || "";
    if (text.trim()) html += renderMarkdownBlock(text);
    if (index + 2 < chunks.length) {
      const code = chunks[index + 2].replace(/\n$/, "");
      const language = chunks[index + 1].trim();
      html += `<pre><button class="copy-code" type="button">Copy</button><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(code)}</code></pre>`;
    }
  }
  return html;
}

function renderMarkdownBlock(text) {
  const lines = text.trim().split("\n");
  const output = [];
  let paragraph = [];
  let listType = "";
  let listItems = [];

  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${paragraph.map(markdownInline).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    output.push(`<${listType}>${listItems.map((item) => `<li>${markdownInline(item)}</li>`).join("")}</${listType}>`);
    listItems = [];
    listType = "";
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const list = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      output.push(`<h${level}>${markdownInline(heading[2])}</h${level}>`);
    } else if (list) {
      flushParagraph();
      const type = /^\s*\d+\./.test(line) ? "ol" : "ul";
      if (listType && listType !== type) flushList();
      listType = type;
      listItems.push(list[1]);
    } else if (quote) {
      flushParagraph();
      flushList();
      output.push(`<blockquote>${markdownInline(quote[1])}</blockquote>`);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return output.join("");
}

function setStatus(text, state = "") {
  elements.statusText.textContent = text;
  elements.status.className = `connection-status${state ? ` ${state}` : ""}`;
}

function showToast(message, isError = false) {
  clearTimeout(toastTimeout);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  toastTimeout = setTimeout(() => elements.toast.classList.remove("visible"), 3800);
}

function persistChats() {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chats));
  } catch (error) {
    console.error("Could not save chat history:", error);
    showToast("Chat history could not be saved in this browser.", true);
  }
}

function loadChats() {
  try {
    const saved = localStorage.getItem(CHAT_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (Array.isArray(parsed)) {
      chats = parsed.filter((chat) => (
        chat && typeof chat.id === "string" && Array.isArray(chat.messages)
      ));
    }
  } catch (error) {
    console.error("Could not read chat history:", error);
    showToast("Saved chat history could not be read.", true);
  }
}

function activeChat() {
  return chats.find((chat) => chat.id === activeChatId) || null;
}

function renderChatList() {
  elements.chatList.replaceChildren();
  if (!chats.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Your conversations will appear here.";
    elements.chatList.append(empty);
    return;
  }
  for (const chat of [...chats].reverse()) {
    const item = document.createElement("div");
    item.className = `history-item${chat.id === activeChatId ? " active" : ""}`;
    const open = document.createElement("button");
    open.className = `history-item${chat.id === activeChatId ? " active" : ""}`;
    open.type = "button";
    open.setAttribute("aria-label", `Open chat: ${chat.title || "New chat"}`);
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2 1-4a7.5 7.5 0 1 1 16-5.5Z" /></svg>';
    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = chat.title || "New chat";
    const remove = document.createElement("button");
    remove.className = "delete-chat";
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete chat: ${chat.title || "New chat"}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg>';
    open.append(title);
    open.addEventListener("click", () => selectChat(chat.id));
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChat(chat.id);
    });
    item.className = "history-row";
    item.append(open, remove);
    elements.chatList.append(item);
  }
}

function renderMessages() {
  const chat = activeChat();
  const messages = chat?.messages || [];
  elements.welcome.hidden = messages.length > 0;
  elements.messages.hidden = messages.length === 0;
  elements.messages.replaceChildren();
  for (const message of messages) {
    const row = document.createElement("article");
    row.className = `message ${message.role === "user" ? "user" : "assistant"}`;
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = message.role === "user" ? "Y" : "✦";
    const content = document.createElement("div");
    content.className = "message-content";
    if (message.role === "assistant") {
      content.innerHTML = message.content ? markdownToHtml(message.content) : '<div class="thinking-dots" aria-label="Thinking"><span></span><span></span><span></span></div>';
    } else {
      content.textContent = message.content;
      if (Array.isArray(message.attachments) && message.attachments.length) {
        const attachmentRow = document.createElement("div");
        attachmentRow.className = "message-attachments";
        for (const file of message.attachments) {
          const chip = document.createElement("span");
          chip.className = "attachment-chip";
          chip.textContent = `${file.type === "application/pdf" ? "PDF" : file.type.startsWith("image/") ? "IMG" : "FILE"} · ${file.name}`;
          attachmentRow.append(chip);
        }
        content.append(attachmentRow);
      }
    }
    row.append(avatar, content);
    elements.messages.append(row);
  }
  elements.messages.querySelectorAll(".copy-code").forEach((button) => {
    button.addEventListener("click", async () => {
      const code = button.nextElementSibling?.textContent || "";
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "Copied";
        setTimeout(() => { button.textContent = "Copy"; }, 1400);
      } catch (error) {
        console.error("Could not copy code:", error);
        showToast("Could not copy code to the clipboard.", true);
      }
    });
  });
  requestAnimationFrame(() => {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  });
  updateTokenMeter();
}

function newChat() {
  activeChatId = null;
  pendingFiles = [];
  renderChatList();
  renderMessages();
  renderPendingFiles();
  elements.messageInput.value = "";
  elements.messageInput.focus();
  closeSidebar();
}

function selectChat(id) {
  activeChatId = id;
  pendingFiles = [];
  renderChatList();
  renderMessages();
  renderPendingFiles();
  closeSidebar();
}

function deleteChat(id) {
  chats = chats.filter((chat) => chat.id !== id);
  if (activeChatId === id) activeChatId = null;
  persistChats();
  renderChatList();
  renderMessages();
}

function openSettings() {
  elements.settingsModal.hidden = false;
}

function closeSettings() {
  elements.settingsModal.hidden = true;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderPendingFiles() {
  elements.attachmentList.replaceChildren();
  for (const file of pendingFiles) {
    const card = document.createElement("div");
    card.className = "pending-file";
    const type = document.createElement("span");
    type.className = "file-type-icon";
    type.textContent = file.type === "application/pdf" ? "PDF" : file.type.startsWith("image/") ? "IMG" : file.extension;
    const details = document.createElement("span");
    details.className = "pending-file-copy";
    const name = document.createElement("strong");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(file.size);
    details.append(name, size);
    const remove = document.createElement("button");
    remove.className = "remove-file";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>';
    remove.addEventListener("click", () => {
      pendingFiles = pendingFiles.filter((item) => item.id !== file.id);
      renderPendingFiles();
    });
    card.append(type, details, remove);
    elements.attachmentList.append(card);
  }
  updateTokenMeter();
}

async function extractPdfText(file) {
  if (!pdfJsPromise) {
    pdfJsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs");
  }
  const pdfjs = await pdfJsPromise;
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  try {
    const pageCount = Math.min(document.numPages, 30);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      if (pages.join("\n").length >= MAX_ATTACHMENT_CONTEXT) break;
    }
  } finally {
    await document.destroy();
  }
  const text = pages.join("\n").slice(0, MAX_ATTACHMENT_CONTEXT).trim();
  if (!text) throw new Error(`No selectable text was found in "${file.name}". Scanned PDFs are not supported.`);
  return text;
}

async function addFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    if (pendingFiles.length >= MAX_FILES) {
      showToast(`You can attach up to ${MAX_FILES} files at a time.`, true);
      break;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const isPdf = file.type === "application/pdf" || extension === "pdf";
    const isText = textExtensions.has(extension) || file.type.startsWith("text/") || file.type === "application/json";
    if (file.type.startsWith("image/")) {
      showToast("This no-login AI model supports text and PDF files, not images.", true);
      continue;
    }
    if (!isPdf && !isText) {
      showToast(`"${file.name}" is not supported. Attach a text file or PDF.`, true);
      continue;
    }
    if (file.size > (isText ? MAX_TEXT_FILE_SIZE : MAX_FILE_SIZE)) {
      showToast(isText ? "Text files must be 1 MB or smaller." : "PDFs must be 8 MB or smaller.", true);
      continue;
    }
    try {
      let text = "";
      if (isText) text = await file.text();
      else if (isPdf) text = await extractPdfText(file);
      pendingFiles.push({
        id: makeId(),
        name: file.name,
        type: isPdf ? "application/pdf" : "text/plain",
        extension: isPdf ? "pdf" : extension.slice(0, 4) || "txt",
        size: file.size,
        text,
      });
    } catch (error) {
      console.error("Could not read attachment:", error);
      showToast(error.message || `Could not read "${file.name}".`, true);
    }
  }
  renderPendingFiles();
  elements.messageInput.focus();
  elements.fileInput.value = "";
}

function attachmentContext(files) {
  return files
    .filter((file) => file.text)
    .map((file) => `Contents of ${file.name}:\n${file.text.slice(0, MAX_ATTACHMENT_CONTEXT)}`)
    .join("\n\n");
}

function estimateTokens(text) {
  return Math.ceil(Array.from(text).length / 4);
}

function updateTokenMeter() {
  const chat = activeChat();
  const draft = elements.messageInput.value.trim();
  const context = attachmentContext(pendingFiles);
  const hasDraft = Boolean(draft || context);
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(chat?.messages || []).map((message) => ({
      role: message.role,
      content: [message.content, message.context].filter(Boolean).join("\n\n"),
    })),
    ...(hasDraft ? [{
      role: "user",
      content: [
        draft || (pendingFiles.length === 1 ? `Please review ${pendingFiles[0].name}.` : `Please review these ${pendingFiles.length} files.`),
        context,
      ].filter(Boolean).join("\n\n"),
    }] : []),
  ];
  const used = hasDraft || chat?.messages.length
    ? messages.reduce((total, message) => total + estimateTokens(`${message.role}\n${message.content}`) + 4, 0)
    : 0;
  const available = Math.max(0, MODEL_CONTEXT_LIMIT - used - MAX_RESPONSE_TOKENS);
  const percentage = Math.min(100, (used / MODEL_CONTEXT_LIMIT) * 100);
  elements.tokenUsageLabel.textContent = `~${used.toLocaleString()} / ${MODEL_CONTEXT_LIMIT.toLocaleString()} tokens`;
  elements.tokenAvailable.textContent = `~${available.toLocaleString()} available`;
  elements.tokenMeter.style.width = `${percentage}%`;
  elements.tokenUsage.setAttribute("aria-valuenow", String(Math.min(MODEL_CONTEXT_LIMIT, used)));
}

function addChatMessage(chat, role, content, attachments = [], context = "") {
  chat.messages.push({
    role,
    content,
    ...(context ? { context } : {}),
    ...(attachments.length ? { attachments: attachments.map(({ name, type }) => ({ name, type })) } : {}),
  });
}

async function streamResponse(response, onText) {
  if (!response.body) {
    const payload = await response.json();
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("The model returned an empty response.");
    onText(text);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = "";
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        if (data === "[DONE]") done = true;
        continue;
      }
      let event;
      try {
        event = JSON.parse(data);
      } catch (error) {
        console.warn("Skipping an unparseable model stream event:", error);
        continue;
      }
      if (event.error?.message) throw new Error(event.error.message);
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        result += delta;
        onText(result);
      }
    }
    if (chunk.done) done = true;
  }
  if (!result.trim()) throw new Error("The model returned an empty response.");
  return result;
}

function displayApiError(response, payload) {
  const message = payload?.error?.message || payload?.message;
  if (response.status === 402) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? ` Try again in about ${Math.ceil(retryAfter)} seconds.`
      : " Wait about 30 seconds, then try again.";
    return `The free API is limited to one request every 30 seconds per IP.${wait}`;
  }
  if (response.status === 429) return "The free AI service is busy. Please wait a moment and try again.";
  if (response.status === 413) return "Your request is too large. Remove some files or shorten the conversation.";
  return message || `The free AI service returned an error (${response.status}).`;
}

function getWeatherLocation(prompt) {
  const match = prompt.match(/\b(?:in|for|at|around|near)\s+([\p{L}][\p{L}\p{M} .,'-]{1,60}?)(?=\s+(?:today|tonight|tomorrow|this week|this weekend|next week|right now)\b|[?.!,]|$)/iu);
  if (!match) return "";
  const location = match[1].trim().replace(/\s+/g, " ");
  if (/^(?:my location|my area|here|there|the weather|the forecast)$/i.test(location)) return "";
  return location;
}

function isWeatherQuestion(prompt) {
  return /\b(?:weather|forecast|temperature|rain(?:ing)?|snow(?:ing)?|wind(?:y)?)\b/i.test(prompt);
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Weather service returned an error (${response.status}).`);
  return response.json();
}

async function getWeather(prompt, signal) {
  let place;
  const locationName = getWeatherLocation(prompt);
  if (locationName) {
    const geocoding = await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationName)}&count=1&language=en&format=json`,
      signal,
    );
    place = geocoding.results?.[0];
    if (!place) throw new Error(`I couldn't find "${locationName}". Please check the city or town name and try again.`);
  } else {
    if (!navigator.geolocation) {
      throw new Error("Please include a city or town in your weather question; location access isn't available in this browser.");
    }
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        resolve,
        () => reject(new Error("Please include a city or town in your weather question, or allow location access in your browser.")),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
      );
    });
    place = {
      name: "Your current location",
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  }

  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    forecast_days: "3",
    timezone: "auto",
  });
  const forecast = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`, signal);
  const current = forecast.current;
  const daily = forecast.daily;
  if (!current || !daily?.time?.length) throw new Error("The weather service returned incomplete forecast data. Please try again.");
  const description = (code) => WEATHER_CODE_DESCRIPTIONS[code] || "unknown conditions";
  const location = [place.name, place.admin1, place.country].filter(Boolean).join(", ");
  return { location, current, daily, timezone: forecast.timezone, description };
}

function formatWeatherReport(weather) {
  const { current, daily, description } = weather;
  const forecastLines = daily.time.map((date, index) => (
    `- **${date}:** ${description(daily.weather_code[index])}, high ${daily.temperature_2m_max[index]}°C, low ${daily.temperature_2m_min[index]}°C, precipitation chance ${daily.precipitation_probability_max[index] ?? "unavailable"}%.`
  ));
  return [
    `## Weather for ${weather.location}`,
    `Current conditions (${current.time}, ${weather.timezone}): **${description(current.weather_code)}**, ${current.temperature_2m}°C (feels like ${current.apparent_temperature}°C).`,
    `Humidity: ${current.relative_humidity_2m}% · Wind: ${current.wind_speed_10m} km/h · Precipitation: ${current.precipitation} mm.`,
    "",
    "### Three-day forecast",
    ...forecastLines,
    "",
    "Source: [Open-Meteo](https://open-meteo.com/).",
  ].join("\n");
}

async function sendMessage(event) {
  event?.preventDefault();
  if (activeController) {
    activeController.abort();
    return;
  }
  const prompt = elements.messageInput.value.trim();
  const files = [...pendingFiles];
  if (!prompt && !files.length) return;
  if (files.some((file) => file.type.startsWith("image/"))) {
    showToast("This no-login model supports text and PDFs, not images. Remove the image to continue.", true);
    return;
  }
  let chat = activeChat();
  if (!chat) {
    chat = { id: makeId(), title: prompt.slice(0, 48) || files[0]?.name || "New chat", messages: [] };
    chats.push(chat);
    activeChatId = chat.id;
  }
  if (!chat.messages.length) chat.title = prompt.slice(0, 48) || files[0]?.name || "New chat";
  const storedPrompt = prompt || (files.length === 1 ? `Please review ${files[0].name}.` : `Please review these ${files.length} files.`);
  addChatMessage(chat, "user", storedPrompt, files, attachmentContext(files));
  elements.messageInput.value = "";
  pendingFiles = [];
  renderPendingFiles();
  resizeInput();
  renderChatList();
  renderMessages();
  persistChats();
  elements.sendButton.classList.add("is-loading");
  elements.sendButton.setAttribute("aria-label", "Stop response");
  elements.sendButton.title = "Stop response";
  activeController = new AbortController();
  setStatus("Thinking…");

  try {
    if (isWeatherQuestion(storedPrompt)) {
      setStatus("Checking weather…");
      const weather = await getWeather(storedPrompt, activeController.signal);
      chat.messages.push({ role: "assistant", content: formatWeatherReport(weather) });
      persistChats();
      renderMessages();
      setStatus("Ready", "ready");
      return;
    }
    const history = chat.messages.map((message) => ({
      role: message.role,
      content: [message.content, message.context].filter(Boolean).join("\n\n"),
    }));
    const response = await fetch(CHAT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL_ID,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
        ],
        stream: true,
        max_tokens: MAX_RESPONSE_TOKENS,
      }),
      signal: activeController.signal,
    });
    if (!response.ok) {
      let payload = {};
      try {
        const contentType = response.headers.get("Content-Type") || "";
        payload = contentType.includes("json")
          ? await response.json()
          : { message: await response.text() };
      } catch (error) {
        console.warn("Free AI service error response could not be read:", error);
      }
      throw new Error(displayApiError(response, payload));
    }
    const assistant = { role: "assistant", content: "" };
    chat.messages.push(assistant);
    renderMessages();
    const assistantRow = elements.messages.lastElementChild;
    const assistantContent = assistantRow?.querySelector(".message-content");
    const streamingText = document.createTextNode("");
    assistantContent?.replaceChildren(streamingText);
    const result = await streamResponse(response, (content) => {
      assistant.content = content;
      streamingText.data = content;
    });
    assistant.content = result;
    if (assistantContent) assistantContent.innerHTML = markdownToHtml(result);
    persistChats();
    updateTokenMeter();
    setStatus("Ready", "ready");
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Response stopped", "warning");
      showToast("Response stopped.");
    } else {
      console.error("Could not complete the chat request:", error);
      const blankAssistant = chat.messages.at(-1);
      if (blankAssistant?.role === "assistant" && !blankAssistant.content) chat.messages.pop();
      persistChats();
      renderMessages();
      setStatus("Request failed", "error");
      showToast(error.message || "The request failed. Check your connection and try again.", true);
    }
  } finally {
    activeController = null;
    elements.sendButton.classList.remove("is-loading");
    elements.sendButton.setAttribute("aria-label", "Send message");
    elements.sendButton.title = "Send message";
    if (elements.status.classList.contains("warning")) {
      setStatus("Ready", "ready");
    }
  }
}

function resizeInput() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 170)}px`;
}

function openSidebar() {
  elements.sidebar.classList.add("open");
  elements.sidebarScrim.classList.add("visible");
}

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.sidebarScrim.classList.remove("visible");
}

document.querySelector("#newChat").addEventListener("click", newChat);
document.querySelector("#openSettings").addEventListener("click", openSettings);
document.querySelector("#topSettings").addEventListener("click", openSettings);
document.querySelector("#closeSettings").addEventListener("click", closeSettings);
document.querySelector("#cancelSettings").addEventListener("click", closeSettings);
document.querySelector("#attachButton").addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", (event) => addFiles(event.target.files));
elements.chatForm.addEventListener("submit", sendMessage);
elements.messageInput.addEventListener("input", () => {
  resizeInput();
  updateTokenMeter();
});
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendMessage(event);
  }
});
document.querySelectorAll(".suggestion-card").forEach((card) => {
  card.addEventListener("click", () => {
    elements.messageInput.value = card.dataset.prompt || "";
    resizeInput();
    elements.messageInput.focus();
  });
});
elements.settingsModal.addEventListener("click", (event) => {
  if (event.target === elements.settingsModal) closeSettings();
});
document.querySelector("#menuButton").addEventListener("click", openSidebar);
document.querySelector("#sidebarClose").addEventListener("click", closeSidebar);
elements.sidebarScrim.addEventListener("click", closeSidebar);
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    newChat();
  }
  if (event.key === "Escape") {
    closeSettings();
    closeSidebar();
  }
});
elements.conversation.addEventListener("dragover", (event) => {
  event.preventDefault();
});
elements.conversation.addEventListener("drop", (event) => {
  event.preventDefault();
  if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
});

loadChats();
renderChatList();
renderMessages();
setStatus("No-login AI", "ready");
