type Store = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
type Renewal = { token: string; accountId: string; expiresAt: string; refreshToken: string; refreshExpiresAt: string };
const access = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,19}\|[A-Za-z0-9]{40}$/.test(value);
const refresh = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(value);

/** One rotation in flight, with a durable retry journal. Never reads account keys. */
export class IdentityRenewal {
  private flight?: Promise<string | null>;
  private generation = 0;
  constructor(private store: Store, private renew: (token: string, request: string) => Promise<Renewal>, private now = Date.now) {}

  async invalidate(): Promise<void> {
    this.generation++;
    await this.flight?.catch(() => undefined);
  }

  ensure(): Promise<string | null> {
    if (this.flight) return this.flight;
    const generation = this.generation;
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    const work = locks ? Promise.resolve(locks.request('stellar-notes-identity-renewal', () => this.perform(generation))) : this.perform(generation);
    const running = work.finally(() => { this.flight = undefined; });
    this.flight = running; return running;
  }

  private async perform(generation: number): Promise<string | null> {
    let token = await this.store.getItem('ssToken');
    if (await this.store.getItem('ssAuthVersion') !== '2') return token;
    let raw = await this.store.getItem('ssIdentitySession');
    if (!raw || !token) return null;
    let session: any, user: any;
    const ownerRaw = await this.store.getItem('ssUser');
    try { session = JSON.parse(raw); user = JSON.parse(ownerRaw || 'null'); } catch { return null; }
    if (!user || String(user.id) !== session.accountId || typeof session.email !== 'string'
      || String(user.email).trim().toLowerCase() !== session.email.trim().toLowerCase()) return null;
    const current = async () => generation === this.generation && await this.store.getItem('ssIdentitySession') === raw
      && await this.store.getItem('ssToken') === token && await this.store.getItem('ssUser') === ownerRaw;
    // Repair only the known two-write rotation window, never a removed session.
    if (access(session.accessToken) && session.tokenId === session.accessToken.split('|')[0]
      && session.previousTokenId === token.split('|')[0] && token !== session.accessToken) {
      if (!await current()) return null;
      await this.store.setItem('ssToken', session.accessToken); token = session.accessToken;
    }
    if (!token || session.tokenId !== token.split('|')[0] || !Number.isFinite(Date.parse(session.expiresAt))) return null;
    const valid = () => Date.parse(session.expiresAt) > this.now() ? token : null;
    if (Date.parse(session.expiresAt) > this.now() + 60000) return token;
    if (session.refreshRejected) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return valid();
    if (!refresh(session.refreshToken) || Date.parse(session.refreshExpiresAt) <= this.now()
      || !Number.isFinite(Date.parse(session.refreshExpiresAt))) return valid();
    if (!await current()) return null;
    if (!/^[a-f0-9]{32}$/.test(session.refreshRequestId || '')) {
      session.refreshRequestId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      raw = JSON.stringify(session); await this.store.setItem('ssIdentitySession', raw);
    }
    try {
      const next = await this.renew(session.refreshToken, session.refreshRequestId);
      if (!await current()) return null;
      if (next.accountId !== session.accountId || !access(next.token) || !refresh(next.refreshToken)
        || !Number.isFinite(Date.parse(next.expiresAt)) || Date.parse(next.expiresAt) <= this.now()
        || Date.parse(next.expiresAt) > this.now() + 17 * 60000
        || !Number.isFinite(Date.parse(next.refreshExpiresAt)) || Date.parse(next.refreshExpiresAt) <= this.now()
        || Date.parse(next.refreshExpiresAt) > this.now() + 31 * 86400000) throw new Error('identityVerificationFailed');
      const saved = JSON.stringify({ accountId: session.accountId, email: session.email, keyEnvelope: session.keyEnvelope,
        tokenId: next.token.split('|')[0], accessToken: next.token, previousTokenId: token!.split('|')[0],
        expiresAt: next.expiresAt, refreshToken: next.refreshToken, refreshExpiresAt: next.refreshExpiresAt });
      await this.store.setItem('ssIdentitySession', saved);
      await this.store.setItem('ssToken', next.token);
      return next.token;
    } catch (error: any) {
      // Retry transient failures with the SAME durable ID; an ambiguous reply
      // must not cause a second rotation or remove notes, keys or the outbox.
      if (!await current()) return null;
      if (error?.status === 401) {
        await this.store.setItem('ssIdentitySession', JSON.stringify({ ...session, refreshRejected: true }));
        return null;
      }
      return valid();
    }
  }
}
