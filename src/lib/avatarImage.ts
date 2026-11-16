// A picked photo made into a profile picture before upload: the middle square, 512 px, WebP (JPEG where a browser
// can't make WebP). Drawn fresh on a canvas, so the file's own metadata (location, camera) never leaves the device,
// and the upload is tens of KB, whatever the photo was. The server checks it again (server/auth/avatars.ts).
export const AVATAR_SIZE = 512;
/** What a picked file may be before it's shrunk: larger photos are refused rather than decoded. */
export const PICK_MAX_BYTES = 20 * 1024 * 1024;

export async function squarePicture(file: Blob): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("Pick a picture (PNG, JPEG, WebP or GIF).");
  if (file.size > PICK_MAX_BYTES) throw new Error("That picture is too large. Pick one under 20 MB.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("That picture couldn't be opened. Try a PNG or JPEG."); }
  const side = Math.min(bitmap.width, bitmap.height);
  if (!side) throw new Error("That picture is empty.");
  const out = Math.min(AVATAR_SIZE, side);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, out, out);
  bitmap.close?.();
  const encode = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  let blob = await encode("image/webp", 0.86);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.88);
  if (!blob) throw new Error("That picture couldn't be prepared.");
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("That picture couldn't be read."));
    r.readAsDataURL(blob!);
  });
}
