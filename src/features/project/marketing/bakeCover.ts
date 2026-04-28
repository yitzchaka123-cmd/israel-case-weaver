// Client-side compositing helpers for box covers.
// All compositing happens on a <canvas>, then the result is uploaded to the
// `media` bucket and its public URL is returned.
//
// Two entry points:
//   - bakeFrontCover: paints title, subtitle, and company logo onto a raw
//     front-cover render so the user gets a real "game cover" look.
//   - bakeBackCover: paints the EAN-13 barcode (lower right), the primary QR
//     code with its label (lower left), the company logo (top center), any
//     secondary QRs (small strip), and a typeset address/legal/footer block
//     along the bottom edge.
//
// Both helpers receive a single options object so callers can pass only what
// they have. Anything that's missing is simply skipped — the bake never fails
// because a logo is absent.

import { supabase } from "@/integrations/supabase/client";

interface BakeFrontInput {
  projectId: string;
  baseImageUrl: string;
  title?: string | null;
  subtitle?: string | null;
  logoUrl?: string | null;
  companySlogan?: string | null;
  frontSubtext?: string | null;
}

interface BakeBackInput {
  projectId: string;
  baseImageUrl: string;
  barcodeUrl?: string | null;
  primaryQr?: { url: string | null; label?: string | null } | null;
  secondaryQrs?: Array<{ url: string | null; label?: string | null }>;
  logoUrl?: string | null;
  companyName?: string | null;
  address?: string | null;
  legalText?: string | null;
  warningText?: string | null;
  footerLine?: string | null;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    // Cache-bust so freshly-uploaded assets don't get a stale CORS-less copy.
    img.src = url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now();
  });
}

async function ensureFontsLoaded() {
  // Use whatever fonts the page already has — Google Fonts via stylesheet —
  // and just ask the FontFace API to wait for them. Falls back to system
  // sans-serif if unavailable. We pre-warm a few weights/sizes.
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load("700 96px 'Cinzel'"),
      document.fonts.load("400 36px 'Inter'"),
      document.fonts.load("600 28px 'Inter'"),
    ]);
  } catch {
    /* ignore — we'll just render with whatever's available */
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function uploadComposed(
  projectId: string,
  prefix: string,
  blob: Blob,
): Promise<string> {
  const path = `${projectId}/marketing/${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.jpg`;
  const { error } = await supabase.storage
    .from("media")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw error;
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

// =====================================================================
// Front cover
// =====================================================================

export async function bakeFrontCover(input: BakeFrontInput): Promise<string> {
  const { projectId, baseImageUrl, title, subtitle, logoUrl, companySlogan, frontSubtext } = input;

  await ensureFontsLoaded();
  const base = await loadImage(baseImageUrl);
  const logo = logoUrl ? await loadImage(logoUrl).catch(() => null) : null;

  const canvas = document.createElement("canvas");
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(base, 0, 0);

  const W = canvas.width;
  const H = canvas.height;

  // Soft top vignette so title is always readable.
  if (title || subtitle) {
    const grad = ctx.createLinearGradient(0, 0, 0, H * 0.35);
    grad.addColorStop(0, "rgba(0,0,0,0.55)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H * 0.35);
  }

  // Title block (top center)
  if (title) {
    const titleSize = Math.round(W * 0.085);
    ctx.font = `700 ${titleSize}px 'Cinzel', 'Playfair Display', serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = Math.round(titleSize * 0.25);
    const lines = wrapText(ctx, title.toUpperCase(), W * 0.9);
    let y = Math.round(H * 0.06);
    for (const line of lines) {
      ctx.fillText(line, W / 2, y);
      y += titleSize * 1.05;
    }
    ctx.shadowBlur = 0;

    if (subtitle) {
      const subSize = Math.round(W * 0.032);
      ctx.font = `400 ${subSize}px 'Inter', 'Helvetica Neue', sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = Math.round(subSize * 0.4);
      const subLines = wrapText(ctx, subtitle, W * 0.8);
      for (const line of subLines) {
        ctx.fillText(line, W / 2, y + subSize * 0.3);
        y += subSize * 1.25;
      }
      ctx.shadowBlur = 0;
    }
  }

  // Company logo (top right, small)
  if (logo) {
    const targetW = Math.round(W * 0.13);
    const targetH = Math.round((targetW / logo.naturalWidth) * logo.naturalHeight);
    const pad = Math.round(W * 0.025);
    const x = W - targetW - pad;
    const y = pad;
    // Subtle white card behind logo for legibility on busy art.
    const cardPad = Math.round(targetW * 0.08);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(x - cardPad, y - cardPad, targetW + cardPad * 2, targetH + cardPad * 2);
    ctx.drawImage(logo, x, y, targetW, targetH);
  }

  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.93),
  );
  return uploadComposed(projectId, "cover-final", blob);
}

// =====================================================================
// Back cover
// =====================================================================

export async function bakeBackCover(input: BakeBackInput): Promise<string> {
  const {
    projectId,
    baseImageUrl,
    barcodeUrl,
    primaryQr,
    secondaryQrs,
    logoUrl,
    companyName,
    address,
    legalText,
    warningText,
    footerLine,
  } = input;

  await ensureFontsLoaded();
  const [base, barcode, primary, logo, ...secondaries] = await Promise.all([
    loadImage(baseImageUrl),
    barcodeUrl ? loadImage(barcodeUrl).catch(() => null) : Promise.resolve(null),
    primaryQr?.url ? loadImage(primaryQr.url).catch(() => null) : Promise.resolve(null),
    logoUrl ? loadImage(logoUrl).catch(() => null) : Promise.resolve(null),
    ...((secondaryQrs ?? []).map((q) =>
      q.url ? loadImage(q.url).catch(() => null) : Promise.resolve(null),
    )),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = base.naturalWidth;
  canvas.height = base.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(base, 0, 0);

  const W = canvas.width;
  const H = canvas.height;

  // ---- Bottom address/legal strip (must come first so QR/barcode sit above)
  const stripText = [companyName, address, footerLine, warningText, legalText]
    .filter(Boolean)
    .join("  ·  ");
  let bottomReserved = 0;
  if (stripText) {
    const stripH = Math.round(H * 0.075);
    bottomReserved = stripH;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillRect(0, H - stripH, W, stripH);
    ctx.fillStyle = "#1a1a1a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = Math.round(W * 0.018);
    ctx.font = `400 ${fontSize}px 'Inter', sans-serif`;
    const lines = wrapText(ctx, stripText, W * 0.94);
    const lineH = fontSize * 1.3;
    let y = H - stripH / 2 - ((lines.length - 1) * lineH) / 2;
    for (const line of lines) {
      ctx.fillText(line, W / 2, y);
      y += lineH;
    }
  }

  // ---- Barcode (lower right, above bottom strip)
  if (barcode) {
    const targetW = Math.round(W * 0.22);
    const targetH = Math.round((targetW / barcode.naturalWidth) * barcode.naturalHeight);
    const pad = Math.round(W * 0.025);
    const x = W - targetW - pad;
    const y = H - bottomReserved - targetH - pad;
    const cardPad = Math.round(targetW * 0.06);
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - cardPad, y - cardPad, targetW + cardPad * 2, targetH + cardPad * 2);
    ctx.drawImage(barcode, x, y, targetW, targetH);
  }

  // ---- Primary QR (lower left, above bottom strip)
  if (primary) {
    const targetW = Math.round(W * 0.18);
    const targetH = targetW;
    const pad = Math.round(W * 0.025);
    const x = pad;
    const labelH = primaryQr?.label ? Math.round(W * 0.022) : 0;
    const y = H - bottomReserved - targetH - pad - labelH;
    const cardPad = Math.round(targetW * 0.06);
    ctx.fillStyle = "#fff";
    ctx.fillRect(
      x - cardPad,
      y - cardPad,
      targetW + cardPad * 2,
      targetH + cardPad * 2 + labelH,
    );
    ctx.drawImage(primary, x, y, targetW, targetH);
    if (primaryQr?.label) {
      ctx.fillStyle = "#1a1a1a";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const fs = Math.round(W * 0.016);
      ctx.font = `600 ${fs}px 'Inter', sans-serif`;
      ctx.fillText(primaryQr.label, x + targetW / 2, y + targetH + cardPad * 0.4);
    }
  }

  // ---- Company logo (top center, small)
  if (logo) {
    const targetW = Math.round(W * 0.18);
    const targetH = Math.round((targetW / logo.naturalWidth) * logo.naturalHeight);
    const pad = Math.round(W * 0.025);
    const x = (W - targetW) / 2;
    const y = pad;
    const cardPad = Math.round(targetW * 0.08);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(x - cardPad, y - cardPad, targetW + cardPad * 2, targetH + cardPad * 2);
    ctx.drawImage(logo, x, y, targetW, targetH);
  }

  // ---- Secondary QRs (above bottom strip, centered horizontal strip)
  const visibleSecondaries = secondaries
    .map((img, i) => ({ img, label: secondaryQrs?.[i]?.label ?? null }))
    .filter((q) => q.img);
  if (visibleSecondaries.length > 0) {
    const cellW = Math.round(W * 0.1);
    const cellH = cellW;
    const labelH = Math.round(W * 0.014);
    const gap = Math.round(W * 0.015);
    const totalW = visibleSecondaries.length * cellW + (visibleSecondaries.length - 1) * gap;
    let x = (W - totalW) / 2;
    const y = H - bottomReserved - cellH - labelH - Math.round(W * 0.04);
    for (const q of visibleSecondaries) {
      const cardPad = Math.round(cellW * 0.08);
      ctx.fillStyle = "#fff";
      ctx.fillRect(
        x - cardPad,
        y - cardPad,
        cellW + cardPad * 2,
        cellH + cardPad * 2 + labelH,
      );
      ctx.drawImage(q.img!, x, y, cellW, cellH);
      if (q.label) {
        ctx.fillStyle = "#1a1a1a";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const fs = Math.round(W * 0.012);
        ctx.font = `500 ${fs}px 'Inter', sans-serif`;
        ctx.fillText(q.label, x + cellW / 2, y + cellH + cardPad * 0.4);
      }
      x += cellW + gap;
    }
  }

  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.92),
  );
  return uploadComposed(projectId, "back-final", blob);
}
