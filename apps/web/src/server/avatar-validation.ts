/** Small JPEG thumbnails only. Never fetch a submitted URL or serve active formats. */
export function validateAvatarJpeg(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 45000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  let bytes: string;
  try { bytes = atob(value.slice(23)); } catch { return false; }
  if (bytes.length > 32768 || bytes.length < 12 || bytes.charCodeAt(0) !== 255 || bytes.charCodeAt(1) !== 216 || bytes.charCodeAt(bytes.length - 2) !== 255 || bytes.charCodeAt(bytes.length - 1) !== 217) return false;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes.charCodeAt(offset++) !== 255) return false;
    while (bytes.charCodeAt(offset) === 255) offset++;
    const marker = bytes.charCodeAt(offset++);
    if (marker === 218 || marker === 217) return false;
    if (marker === 1 || marker >= 208 && marker <= 215) continue;
    const length = bytes.charCodeAt(offset) * 256 + bytes.charCodeAt(offset + 1);
    if (length < 2 || offset + length > bytes.length) return false;
    if ([192,193,194].includes(marker)) {
      if (length < 8) return false;
      const height = bytes.charCodeAt(offset + 3) * 256 + bytes.charCodeAt(offset + 4);
      const width = bytes.charCodeAt(offset + 5) * 256 + bytes.charCodeAt(offset + 6);
      return width > 0 && height > 0 && width <= 512 && height <= 512;
    }
    offset += length;
  }
  return false;
}
export function googleAvatar(metadata: Record<string, unknown> | null | undefined): string | null {
  const value = metadata?.avatar_url ?? metadata?.picture;
  if (typeof value !== 'string' || value.length > 2048) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && /^([a-z0-9-]+\.)?googleusercontent\.com$/.test(url.hostname) && !url.username && !url.password && !url.port ? url.href : null; } catch { return null; }
}
