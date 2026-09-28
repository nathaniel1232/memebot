const PUMP_BANNER_ID = "launch-guard-pump-draft-status";

function isVisible(element) {
  return Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(getElement, timeout = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const element = getElement();
    if (element) return element;
    await wait(150);
  }
  return null;
}

function normalized(value) {
  return String(value || "").trim();
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("The form field could not be updated");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function associatedLabels(element) {
  const labels = [...(element.labels || [])];
  const wrapping = element.closest("label");
  if (wrapping && !labels.includes(wrapping)) labels.push(wrapping);
  if (element.id) {
    for (const label of document.querySelectorAll("label[for]")) {
      if (label.htmlFor === element.id && !labels.includes(label)) labels.push(label);
    }
  }
  return labels.map((label) => normalized(label.innerText || label.textContent).toLowerCase());
}

function findTextField(kind, excluded = new Set()) {
  const candidates = [...document.querySelectorAll("input:not([type=file]), textarea")].filter(isVisible);
  const match = (element) => {
    const placeholder = normalized(element.placeholder).toLowerCase();
    const ariaLabel = normalized(element.getAttribute("aria-label")).toLowerCase();
    const labels = associatedLabels(element);
    if (kind === "name") return element instanceof HTMLInputElement && (placeholder === "name your coin" || ariaLabel === "coin name" || labels.includes("coin name"));
    if (kind === "ticker") return element instanceof HTMLInputElement && (/^add a coin ticker\b/.test(placeholder) || ariaLabel === "ticker" || labels.includes("ticker"));
    return element instanceof HTMLTextAreaElement && (placeholder === "write a short description" || ariaLabel === "description" || labels.includes("description"));
  };
  return candidates.find((element) => !excluded.has(element) && match(element)) || null;
}

function findUrlField(kind) {
  const candidates = [...document.querySelectorAll('input:not([type=file])')].filter(isVisible);
  const named = candidates.find((input) => {
    const labels = associatedLabels(input);
    const ariaLabel = normalized(input.getAttribute("aria-label")).toLowerCase();
    const id = normalized(input.id).toLowerCase();
    if (kind === "x") return labels.some((label) => ["x", "twitter", "x (twitter)"].includes(label)) || ["x", "twitter", "x url"].includes(ariaLabel) || /^(x|twitter)(-|_)?(url)?$/.test(id);
    return labels.some((label) => ["website", "website url", "site url"].includes(label)) || ["website", "website url", "site url"].includes(ariaLabel) || /^(website|site)(-|_)?(url)?$/.test(id);
  });
  if (named) return named;
  const addUrl = candidates.filter((input) => /add url/i.test(input.placeholder || ""));
  // Pump.fun currently lists Website, X, Telegram in this order when labels are not associated in the DOM.
  return kind === "website" ? addUrl[0] || null : addUrl[1] || null;
}

function fieldMatches(element, expected) {
  return Boolean(element) && normalized(element.value) === normalized(expected);
}

async function fillField(kind, element, expected, fields, required = false) {
  const value = normalized(expected);
  if (!value) {
    fields[kind] = required
      ? { ok: false, error: "Draft value was empty" }
      : { ok: true, skipped: true };
    return;
  }
  if (!element) {
    fields[kind] = { ok: false, error: "Field was not available" };
    return;
  }
  try {
    const findCurrent = () => kind === "xUrl" ? findUrlField("x")
      : kind === "websiteUrl" ? findUrlField("website") : findTextField(kind);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentElement = findCurrent() || element;
      const current = normalized(currentElement.value);
      if (current && current !== value) {
        fields[kind] = { ok: false, error: "Existing value was preserved" };
        return;
      }
      if (current !== value) {
        if (attempt === 0) setNativeValue(currentElement, value);
        else {
          currentElement.focus();
          currentElement.select();
          if (!document.execCommand("insertText", false, value)) setNativeValue(currentElement, value);
        }
      }
      await wait(180);
      const retained = findCurrent() || currentElement;
      if (fieldMatches(retained, value)) {
        await wait(180);
        if (fieldMatches(findCurrent() || retained, value)) {
          fields[kind] = { ok: true };
          return;
        }
      }
    }
    fields[kind] = { ok: false, error: "Pump.fun did not retain the requested value" };
  } catch (error) {
    fields[kind] = { ok: false, error: String(error.message || error) };
  }
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function generatedLogo(draft) {
  const label = String(draft.ticker || draft.name || "TOKEN").replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase() || "TOKEN";
  const seed = hashText(`${draft.name || ""}:${label}`);
  const hue = seed % 360;
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a local logo image");

  const background = context.createLinearGradient(0, 0, 1024, 1024);
  background.addColorStop(0, `hsl(${hue} 90% 65%)`);
  background.addColorStop(1, `hsl(${(hue + 95) % 360} 88% 48%)`);
  context.fillStyle = background;
  context.fillRect(0, 0, 1024, 1024);
  context.fillStyle = "rgba(255,255,255,0.13)";
  for (let i = 0; i < 7; i += 1) {
    const x = 70 + ((seed >>> (i % 24)) % 870);
    const y = 60 + ((seed * (i + 3) >>> 0) % 880);
    context.beginPath();
    context.arc(x, y, 24 + ((seed >>> (i + 5)) % 68), 0, Math.PI * 2);
    context.fill();
  }

  context.fillStyle = "rgba(20, 18, 43, 0.86)";
  context.beginPath();
  context.arc(512, 460, 305, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff7ce";
  context.beginPath();
  context.arc(512, 442, 215, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = `hsl(${(hue + 190) % 360} 78% 42%)`;
  context.beginPath();
  context.arc(512, 475, 150, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(463, 440, 28, 0, Math.PI * 2);
  context.arc(561, 440, 28, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#19172e";
  context.beginPath();
  context.arc(469, 445, 11, 0, Math.PI * 2);
  context.arc(567, 445, 11, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#19172e";
  context.lineWidth = 18;
  context.lineCap = "round";
  context.beginPath();
  context.arc(512, 476, 62, 0.25, Math.PI - 0.25);
  context.stroke();
  context.fillStyle = "#fff";
  context.font = "900 112px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 512, 855, 850);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode the local logo image")), "image/png"));
}

function decodeImageData(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error("The supplied draft image was not a supported image data URL");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

async function attachImage(draft, fields) {
  const input = await waitFor(() => [...document.querySelectorAll('input[type="file"]')].find(isVisible) || document.querySelector('input[type="file"]'));
  if (!input) {
    fields.image = { ok: false, error: "Pump.fun's image file input was not available" };
    return;
  }
  try {
    const provided = Boolean(draft.imageDataUrl);
    const blob = provided ? decodeImageData(draft.imageDataUrl) : await generatedLogo(draft);
    const base = String(draft.ticker || "token").replace(/[^a-z0-9]/gi, "").toLowerCase() || "token";
    const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "png";
    const file = new File([blob], `${base}-logo.${extension}`, { type: blob.type, lastModified: Date.now() });
    const previousImageSources = new Set([...document.querySelectorAll("img")].map((image) => image.currentSrc || image.src));
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const startedAt = Date.now();
    let confirmed = false;
    while (Date.now() - startedAt < 3000) {
      const uploaded = input.files?.[0];
      const retained = uploaded?.name === file.name && uploaded?.type === file.type;
      const visibleFilename = [...document.querySelectorAll("body *")].some((element) => {
        if (!isVisible(element) || element.children.length > 0) return false;
        return normalized(element.textContent).includes(file.name);
      });
      const preview = [...document.querySelectorAll("img")].some((image) => {
        if (!isVisible(image) || !image.complete || image.naturalWidth < 1) return false;
        const source = image.currentSrc || image.src || "";
        if (!source || previousImageSources.has(source)) return false;
        const nearInput = input.parentElement?.contains(image) || input.parentElement?.parentElement?.contains(image);
        return nearInput || source.startsWith("blob:");
      });
      if (retained && (visibleFilename || preview)) {
        confirmed = true;
        break;
      }
      await wait(200);
    }
    fields.image = confirmed
      ? { ok: true, filename: file.name, source: provided ? "provided" : "generated" }
      : { ok: false, error: "The selected file was not retained with a matching filename or preview" };
  } catch (error) {
    fields.image = { ok: false, error: String(error.message || error) };
  }
}

function showBanner(success, message) {
  document.getElementById(PUMP_BANNER_ID)?.remove();
  const banner = document.createElement("div");
  banner.id = PUMP_BANNER_ID;
  banner.setAttribute("role", "status");
  banner.textContent = `Launch Guard · ${message} Review every field and your image before continuing.`;
  Object.assign(banner.style, {
    position: "fixed", zIndex: "2147483647", top: "12px", left: "50%", transform: "translateX(-50%)",
    maxWidth: "min(720px, calc(100vw - 28px))", padding: "14px 18px", borderRadius: "12px",
    color: "white", background: success ? "#176b45" : "#9b3b24", boxShadow: "0 8px 28px rgba(0,0,0,.35)",
    font: "600 14px/1.45 system-ui, sans-serif",
  });
  document.documentElement.append(banner);
}

async function preparePumpDraft(draft) {
  const fields = {};
  const name = String(draft.name || "").trim();
  const ticker = String(draft.ticker || "").trim();
  const description = String(draft.description || "").trim();
  const xUrl = String(draft.xUrl || "").trim();
  const websiteUrl = String(draft.websiteUrl || "").trim();

  const nameInput = await waitFor(() => findTextField("name"));
  const tickerInput = await waitFor(() => findTextField("ticker", new Set(nameInput ? [nameInput] : [])));
  const descriptionInput = await waitFor(() => findTextField("description", new Set([nameInput, tickerInput].filter(Boolean))));
  if (!nameInput || !tickerInput || !descriptionInput) {
    const message = "Pump.fun's create form fields were not available. Sign in if needed, open the create form, and retry.";
    showBanner(false, message);
    return { success: false, message, fields: { name: { ok: Boolean(nameInput) }, ticker: { ok: Boolean(tickerInput) }, description: { ok: Boolean(descriptionInput) } } };
  }

  await fillField("name", nameInput, name, fields, true);
  await fillField("ticker", tickerInput, ticker, fields, true);
  await fillField("description", descriptionInput, description, fields, true);

  if (xUrl || websiteUrl) {
    let xInput = findUrlField("x");
    let websiteInput = findUrlField("website");
    if (!xInput || (websiteUrl && !websiteInput)) {
      const linksButton = [...document.querySelectorAll("button")].find((button) => isVisible(button) && /add social links/i.test(button.innerText || button.textContent || ""));
      if (linksButton) linksButton.click();
      await waitFor(() => findUrlField(xUrl ? "x" : "website"), 3000);
      xInput = findUrlField("x");
      websiteInput = findUrlField("website");
    }
    if (xUrl) await fillField("xUrl", xInput, xUrl, fields);
    if (websiteUrl) await fillField("websiteUrl", websiteInput, websiteUrl, fields);
  }

  await attachImage(draft, fields);
  const finalNameInput = findTextField("name");
  const finalTickerInput = findTextField("ticker", new Set(finalNameInput ? [finalNameInput] : []));
  const finalDescriptionInput = findTextField("description", new Set([finalNameInput, finalTickerInput].filter(Boolean)));
  for (const [kind, expected, current] of [
    ["name", name, finalNameInput],
    ["ticker", ticker, finalTickerInput],
    ["description", description, finalDescriptionInput],
  ]) {
    if (expected && fields[kind]?.ok && (!current || !fieldMatches(current, expected))) {
      fields[kind] = { ok: false, error: "Value did not persist after Pump.fun updated the form" };
    }
  }
  if (xUrl && fields.xUrl?.ok && !fieldMatches(findUrlField("x"), xUrl)) fields.xUrl = { ok: false, error: "X URL did not persist after Pump.fun updated the form" };
  if (websiteUrl && fields.websiteUrl?.ok && !fieldMatches(findUrlField("website"), websiteUrl)) fields.websiteUrl = { ok: false, error: "Website URL did not persist after Pump.fun updated the form" };
  const failures = Object.entries(fields).filter(([, result]) => !result.ok).map(([key, result]) => `${key}: ${result.error || "confirmation failed"}`);
  const success = failures.length === 0;
  const message = success
    ? "Pump.fun draft is ready."
    : `Pump.fun draft is partial. ${failures.join("; ")}.`;
  showBanner(success, message);
  return { success, message, fields };
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "pump_draft_ping") return Promise.resolve({ ready: true });
  if (message?.type === "prepare_pump_draft") return preparePumpDraft(message.draft || {});
  return undefined;
});
