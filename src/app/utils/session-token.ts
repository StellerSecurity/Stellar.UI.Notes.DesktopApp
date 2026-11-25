export async function sessionToken(store: { getItem(key: string): Promise<string | null> }, now = Date.now()): Promise<string | null> {
  const token = await store.getItem('ssToken');
  if (!token || await store.getItem('ssAuthVersion') !== '2') return token;
  try {
    const raw = await store.getItem('ssIdentitySession');
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.tokenId !== token.split('|')[0] || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= now) return null;
    return token;
  } catch { return null; }
}
