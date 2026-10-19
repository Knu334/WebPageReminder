export type Reencoded = { dataUrl: string; width: number; height: number };

export const decodedSize = (dataUrl: string): number => {
  const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
};

// 16px と8回は、縮小の繰り返しを必ず終わらせるための打ち切り（この計画で決めた値）
export const shrinkToLimit = async (
  dataUrl: string,
  reencode: (dataUrl: string) => Promise<Reencoded>,
  limit = 1_048_576,
): Promise<string | null> => {
  let cur = dataUrl;
  for (let i = 0; decodedSize(cur) > limit; i++) {
    if (i === 8) return null;
    const r = await reencode(cur);
    if (decodedSize(r.dataUrl) <= limit) return r.dataUrl;
    if (Math.max(r.width, r.height) < 16) return null;
    cur = r.dataUrl;
  }
  return cur;
};

// popup 専用（DOM の Image と canvas を使う）。幅と高さを半分にして JPEG quality 0.5
export const canvasHalve = (dataUrl: string): Promise<Reencoded> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(img.naturalWidth / 2);
      canvas.height = Math.floor(img.naturalHeight / 2);
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL("image/jpeg", 0.5), width: canvas.width, height: canvas.height });
    };
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
