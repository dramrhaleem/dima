export function followTarget(input: string): string | null {
  const value = input.trim();
  if (/^[a-zA-Z0-9-]+$/.test(value)) return value;
  try {
    const url = new URL(value.startsWith('dima.study/') ? `https://${value}` : value, 'https://dima.study');
    if (url.origin !== 'https://dima.study') return null;
    const match = /^\/(?:u|app\/progress\/members)\/([a-zA-Z0-9-]+)\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch { return null; }
}

