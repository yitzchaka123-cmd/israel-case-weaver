import QRCode from "qrcode";

export async function createQrPngBlob(value: string): Promise<Blob> {
  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 900,
  });
  const response = await fetch(dataUrl);
  return response.blob();
}
