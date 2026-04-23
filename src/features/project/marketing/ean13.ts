// Tiny self-contained EAN-13 generator + SVG renderer. No deps.
// EAN-13: 12 data digits + 1 check digit. We use prefix "200"
// (in-store / restricted distribution range — safe for non-retail use)
// and 9 random digits.

const L: Record<string, string> = {
  "0": "0001101", "1": "0011001", "2": "0010011", "3": "0111101",
  "4": "0100011", "5": "0110001", "6": "0101111", "7": "0111011",
  "8": "0110111", "9": "0001011",
};
const G: Record<string, string> = {
  "0": "0100111", "1": "0110011", "2": "0011011", "3": "0100001",
  "4": "0011101", "5": "0111001", "6": "0000101", "7": "0010001",
  "8": "0001001", "9": "0010111",
};
const R: Record<string, string> = {
  "0": "1110010", "1": "1100110", "2": "1101100", "3": "1000010",
  "4": "1011100", "5": "1001110", "6": "1010000", "7": "1000100",
  "8": "1001000", "9": "1110100",
};
// Parity pattern for digits 2..7 based on first digit
const PARITY: Record<string, string> = {
  "0": "LLLLLL", "1": "LLGLGG", "2": "LLGGLG", "3": "LLGGGL",
  "4": "LGLLGG", "5": "LGGLLG", "6": "LGGGLL", "7": "LGLGLG",
  "8": "LGLGGL", "9": "LGGLGL",
};

export function ean13Checksum(d12: string): number {
  if (!/^\d{12}$/.test(d12)) throw new Error("EAN-13 needs 12 digits");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(d12[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function generateEan13(prefix = "200"): string {
  let core = prefix;
  while (core.length < 12) core += String(Math.floor(Math.random() * 10));
  const check = ean13Checksum(core);
  return core + check;
}

/** Returns an SVG string suitable for inlining or rendering to canvas. */
export function ean13ToSvg(code: string, opts?: { width?: number; height?: number }): string {
  if (!/^\d{13}$/.test(code)) throw new Error("EAN-13 must be exactly 13 digits");
  const width = opts?.width ?? 280;
  const height = opts?.height ?? 110;
  const first = code[0];
  const left = code.slice(1, 7);
  const right = code.slice(7);
  const parity = PARITY[first];

  // 95 modules: 3 (start) + 7*6 (left) + 5 (mid) + 7*6 (right) + 3 (end)
  let bits = "101"; // start guard
  for (let i = 0; i < 6; i++) {
    bits += parity[i] === "L" ? L[left[i]] : G[left[i]];
  }
  bits += "01010"; // middle guard
  for (let i = 0; i < 6; i++) bits += R[right[i]];
  bits += "101"; // end guard

  const moduleW = width / (95 + 22); // leave quiet zone of 11 modules each side
  const quiet = moduleW * 11;
  const barTop = 6;
  const guardExtra = 8;
  const barBottom = height - 22; // leave room for digits at bottom

  let bars = "";
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "1") {
      const isGuard = i < 3 || (i >= 45 && i < 50) || i >= 92;
      const x = quiet + i * moduleW;
      const y = barTop;
      const h = (isGuard ? barBottom + guardExtra : barBottom) - y;
      bars += `<rect x="${x.toFixed(3)}" y="${y}" width="${moduleW.toFixed(3)}" height="${h.toFixed(3)}" fill="#000"/>`;
    }
  }

  // Digits
  const fontSize = 13;
  const ty = height - 5;
  const leftDigitsX = quiet + 3 * moduleW + (42 * moduleW) / 2;
  const rightDigitsX = quiet + 50 * moduleW + (42 * moduleW) / 2;
  const firstX = quiet / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
    ${bars}
    <g font-family="Menlo, Consolas, monospace" font-size="${fontSize}" fill="#000" text-anchor="middle">
      <text x="${firstX.toFixed(2)}" y="${ty}">${first}</text>
      <text x="${leftDigitsX.toFixed(2)}" y="${ty}" letter-spacing="2">${left}</text>
      <text x="${rightDigitsX.toFixed(2)}" y="${ty}" letter-spacing="2">${right}</text>
    </g>
  </svg>`;
}

/** Render the EAN-13 SVG to a PNG Blob via canvas. */
export async function ean13ToPngBlob(code: string, scale = 4): Promise<Blob> {
  const svg = ean13ToSvg(code, { width: 280, height: 110 });
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = (e) => rej(e);
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = 280 * scale;
    canvas.height = 110 * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
