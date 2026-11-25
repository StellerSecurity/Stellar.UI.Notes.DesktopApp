import type * as Opaque from '../../../identity-runtime/node_modules/@serenity-kit/opaque';

type Json = Record<string, any>;
type Identifiers = { client: string; server: string };
export type IdentityTransport = (operation: string, body: Json) => Promise<Json>;
export interface IdentityPins { issuer: string; methodKey: string; opaqueKey: string; }
export interface IdentitySession { accountId: string; email: string; token: string; expiresAt: string; keyEnvelope: string; rootKey: Uint8Array; }
export interface IdentityAccount { accountId: string; revision: number; keyEnvelope: string; }
const utf8 = new TextEncoder();
const fail = (): never => { throw new Error('identityVerificationFailed'); };
const encode = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
const decode = (value: unknown, size?: number): Uint8Array<ArrayBuffer> => {
  if (typeof value !== 'string' || value.length > 65536) return fail();
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return fail(); }
  if (encode(bytes) !== value || (size !== undefined && bytes.length !== size)) return fail();
  return bytes;
};
const urlDecode = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return fail();
  return decode(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
};
const urlEncode = (value: Uint8Array): string => encode(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const accountId = (value: unknown): string => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) ? value : fail();
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);
const fields = (value: Json, names: string[]): void => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== names.sort().join(',')) fail();
};

export class StellarIdClient {
  constructor(
    private readonly pins: IdentityPins,
    private readonly post: IdentityTransport,
    private readonly load: () => Promise<typeof Opaque> = () => import('../../../identity-runtime/node_modules/@serenity-kit/opaque'),
    private readonly now: () => number = Date.now,
  ) {}

  private identifiers(value: unknown, client: string, recovery = false): Identifiers {
    const expected = { client, server: this.pins.issuer + (recovery ? ':recovery' : '') };
    fields(value as Json, ['client', 'server']);
    if ((value as Json)['client'] !== expected.client || (value as Json)['server'] !== expected.server) fail();
    return expected;
  }

  private async runtime(): Promise<typeof Opaque> {
    if (!this.pins.issuer.startsWith('https://') || !this.pins.opaqueKey) throw new Error('identityNotConfigured');
    const opaque = await this.load();
    await opaque.ready;
    return opaque;
  }

  async method(email: string, knownProtected = false): Promise<'legacy' | 'opaque'> {
    if (!this.pins.methodKey || !this.pins.opaqueKey || !this.pins.issuer.startsWith('https://')) throw new Error('identityNotConfigured');
    const normalized = email.trim().toLowerCase();
    const nonce = urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const requestedAt = this.now();
    const response = await this.post('method', { email: normalized, nonce });
    fields(response, ['payload', 'signature']);
    const payload = decode(response['payload']);
    const signature = decode(response['signature'], 64);
    const key = await crypto.subtle.importKey('spki', decode(this.pins.methodKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, payload)) fail();
    let claims: Json;
    try { claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)); } catch { return fail(); }
    fields(claims, ['version', 'purpose', 'issuer', 'email', 'nonce', 'method', 'issuedAt', 'expiresAt']);
    if (claims['version'] !== 1 || claims['purpose'] !== 'stellar-id/login-method/v1' || claims['issuer'] !== this.pins.issuer
      || claims['email'] !== normalized || claims['nonce'] !== nonce || !['legacy', 'opaque'].includes(claims['method'])
      || !Number.isSafeInteger(claims['issuedAt']) || !Number.isSafeInteger(claims['expiresAt'])
      || claims['expiresAt'] - claims['issuedAt'] !== 60 || this.now() - requestedAt > 30000
      || claims['issuedAt'] * 1000 > this.now() + 120000 || claims['expiresAt'] * 1000 < this.now() - 120000
      || (knownProtected && claims['method'] !== 'opaque')) fail();
    return claims['method'];
  }

  private async mac(sessionKey: string, text: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', urlDecode(sessionKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8.encode(text))));
  }

  private accountMac(key: string, purpose: string, flow: string, challenge: string, payload: Json): Promise<string> {
    return this.mac(key, 'stellar-id/opaque-account-' + purpose + '/v1\n' + flow + '\n' + challenge + '\n' + JSON.stringify(payload));
  }

  private async wrappingKey(exportKey: string, identifiers: Identifiers): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey('raw', urlDecode(exportKey), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode(identifiers.server), info: utf8.encode('stellar-id/account-key/v1\n' + identifiers.client) }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  private async wrap(root: Uint8Array, exportKey: string, identifiers: Identifiers): Promise<string> {
    if (root.length !== 32) return fail();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.wrappingKey(exportKey, identifiers), new Uint8Array(root)));
    const packed = new Uint8Array(iv.length + cipher.length);
    packed.set(iv); packed.set(cipher, iv.length);
    return encode(packed);
  }

  private async unwrap(envelope: string, exportKey: string, identifiers: Identifiers): Promise<Uint8Array> {
    const packed = decode(envelope, 60);
    const root = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, await this.wrappingKey(exportKey, identifiers), packed.slice(12)));
    if (root.length !== 32) return fail();
    return root;
  }

  async login(email: string, password: string): Promise<IdentitySession> {
    const opaque = await this.runtime();
    const normalized = email.trim().toLowerCase();
    const start = opaque.client.startLogin({ password });
    const response = await this.post('start', { email: normalized, startLoginRequest: start.startLoginRequest });
    const identifiers = this.identifiers(response['identifiers'], normalized);
    const finished = opaque.client.finishLogin({ password, clientLoginState: start.clientLoginState, loginResponse: response['loginResponse'], identifiers });
    if (!finished || finished.serverStaticPublicKey !== this.pins.opaqueKey) return fail();
    const result = await this.post('finish', { challengeId: response['challengeId'], finishLoginRequest: finished.finishLoginRequest });
    const { serverProof, ...claims } = result;
    if (serverProof !== await this.mac(finished.sessionKey, 'stellar-id/opaque-login/v1\n' + response['challengeId'] + '\n' + JSON.stringify(claims))) return fail();
    const id = accountId(result['accountId']);
    const token = result['token'];
    const expiresAt = result['expiresAt'];
    if (typeof token !== 'string' || !/^[1-9][0-9]{0,19}\|[A-Za-z0-9]{40}$/.test(token)
      || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= this.now()) return fail();
    const rootKey = await this.unwrap(result['keyEnvelope'], finished.exportKey, identifiers);
    return { accountId: id, email: normalized, token, expiresAt, keyEnvelope: result['keyEnvelope'], rootKey };
  }

  private async account(flow: string, password: string, input: Json, root: Uint8Array | null, authorizationPassword?: string, owner?: Pick<IdentitySession, 'accountId' | 'email'>, confirmEnrollment?: () => Promise<string>): Promise<IdentityAccount & { root: Uint8Array }> {
    const opaque = await this.runtime();
    const registration = opaque.client.startRegistration({ password });
    const authorization = authorizationPassword === undefined ? null : opaque.client.startLogin({ password: authorizationPassword });
    const start = await this.post('account/' + flow + '/start', { ...input, registrationRequest: registration.registrationRequest,
      ...(authorization ? { authorizationRequest: authorization.startLoginRequest } : {}) });
    const recoveryCredential = flow === 'recovery-setup';
    const client = flow === 'register' || flow === 'recover' ? input['email'] : recoveryCredential ? 'recovery:' + accountId(owner?.accountId) : owner?.email;
    if (typeof client !== 'string' || !client || client.length > 254) return fail();
    const identifiers = this.identifiers(start['identifiers'], client, recoveryCredential);
    const finished = opaque.client.finishRegistration({ password, clientRegistrationState: registration.clientRegistrationState, registrationResponse: start['registrationResponse'], identifiers });
    if (finished.serverStaticPublicKey !== this.pins.opaqueKey) return fail();
    let authorizing: ReturnType<typeof opaque.client.finishLogin> = undefined;
    if (authorization) {
      const authorClient = flow === 'recover' ? 'recovery:' + accountId(input['accountId']) : owner?.email;
      if (typeof authorClient !== 'string') return fail();
      const authorIdentifiers = this.identifiers(start['authorization']?.identifiers, authorClient, flow === 'recover');
      authorizing = opaque.client.finishLogin({ password: authorizationPassword!, clientLoginState: authorization.clientLoginState, loginResponse: start['authorization']?.loginResponse, identifiers: authorIdentifiers });
      if (!authorizing || authorizing.serverStaticPublicKey !== this.pins.opaqueKey) return fail();
      const opened = await this.unwrap(start['keyEnvelope'], authorizing.exportKey, authorIdentifiers);
      if (root && !sameBytes(root, opened)) { opened.fill(0); return fail(); }
      if (!root) root = opened; else opened.fill(0);
    }
    if (!root) return fail();
    const next = opaque.client.startLogin({ password });
    const payload = { registrationRecord: finished.registrationRecord, startLoginRequest: next.startLoginRequest, keyEnvelope: await this.wrap(root, finished.exportKey, identifiers) };
    const confirmationCode = flow === 'enroll' ? await confirmEnrollment?.() : undefined;
    if (flow === 'enroll' && !/^[0-9]{8}$/.test(confirmationCode || '')) return fail();
    const prove = await this.post('account/' + flow + '/prove', { challengeId: start['challengeId'], ...payload,
      ...(flow === 'enroll' ? { confirmationCode } : {}),
      ...(authorizing! ? { authorizationFinish: authorizing!.finishLoginRequest, authorizationProof: await this.accountMac(authorizing!.sessionKey, 'authorize', flow, start['challengeId'], payload) } : {}) });
    const proveIdentifiers = this.identifiers(prove['identifiers'], client, recoveryCredential);
    const confirmation = opaque.client.finishLogin({ password, clientLoginState: next.clientLoginState, loginResponse: prove['loginResponse'], identifiers: proveIdentifiers });
    if (!confirmation || confirmation.serverStaticPublicKey !== this.pins.opaqueKey || confirmation.exportKey !== finished.exportKey) return fail();
    const result = await this.post('account/' + flow + '/finish', { challengeId: prove['challengeId'], finishLoginRequest: confirmation.finishLoginRequest,
      commitProof: await this.accountMac(confirmation.sessionKey, 'commit', flow, prove['challengeId'], payload) });
    const { serverProof, ...claims } = result;
    if (serverProof !== await this.accountMac(confirmation.sessionKey, 'result', flow, start['challengeId'], claims)
      || result['authVersion'] !== 2 || result['keyEnvelope'] !== payload.keyEnvelope || !Number.isSafeInteger(result['revision']) || result['revision'] < 1) return fail();
    const id = accountId(result['accountId']);
    if ((input['accountId'] && input['accountId'] !== id) || (owner && owner.accountId !== id)) return fail();
    return { accountId: id, revision: result['revision'], keyEnvelope: result['keyEnvelope'], root };
  }

  async register(email: string, password: string, root: Uint8Array): Promise<IdentityAccount> {
    const result = await this.account('register', password, { email: email.trim().toLowerCase() }, root);
    return { accountId: result.accountId, revision: result.revision, keyEnvelope: result.keyEnvelope };
  }

  async enroll(owner: { accountId: string; email: string; token: string }, newPassword: string,
    root: Uint8Array, confirm: () => Promise<string>): Promise<IdentitySession> {
    if (newPassword.length < 12 || root.length !== 32) return fail();
    const account = await this.account('enroll', newPassword, { token: owner.token }, root, undefined, owner, confirm);
    const session = await this.login(owner.email, newPassword);
    if (session.accountId !== account.accountId || !sameBytes(session.rootKey, root)) {
      session.rootKey.fill(0);
      return fail();
    }
    return session;
  }

  async setupRecovery(session: IdentitySession, password: string): Promise<string> {
    const secret = urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const result = await this.account('recovery-setup', secret, { token: session.token }, session.rootKey, password, session);
    if (result.accountId !== session.accountId) return fail();
    return 'STELLAR1.' + session.accountId + '.' + secret;
  }

  async recover(email: string, code: string, newPassword: string): Promise<IdentitySession> {
    const parts = /^STELLAR1\.([1-9][0-9]{0,19})\.([A-Za-z0-9_-]{43})$/.exec(code.trim());
    if (!parts || urlDecode(parts[2]).length !== 32) throw new Error('invalidRecoveryCode');
    const normalized = email.trim().toLowerCase();
    const recovered = await this.account('recover', newPassword, { accountId: parts[1], email: normalized }, null, parts[2]);
    try {
      const session = await this.login(normalized, newPassword);
      if (session.accountId !== recovered.accountId || !sameBytes(session.rootKey, recovered.root)) { session.rootKey.fill(0); return fail(); }
      return session;
    } finally { recovered.root.fill(0); }
  }

  async changePassword(session: IdentitySession, oldPassword: string, newPassword: string): Promise<IdentitySession> {
    const changed = await this.account('password', newPassword, { token: session.token }, session.rootKey, oldPassword, session);
    if (changed.accountId !== session.accountId) return fail();
    const next = await this.login(session.email, newPassword);
    if (next.accountId !== session.accountId || !sameBytes(next.rootKey, session.rootKey)) { next.rootKey.fill(0); return fail(); }
    return next;
  }

  async removeAccount(session: IdentitySession, password: string): Promise<void> {
    const opaque = await this.runtime();
    const authorization = opaque.client.startLogin({ password });
    const started = await this.post('account/delete/start', { token: session.token, authorizationRequest: authorization.startLoginRequest });
    const identifiers = this.identifiers(started['authorization']?.identifiers, session.email);
    const finished = opaque.client.finishLogin({ password, clientLoginState: authorization.clientLoginState, loginResponse: started['authorization']?.loginResponse, identifiers });
    if (!finished || finished.serverStaticPublicKey !== this.pins.opaqueKey) return fail();
    const result = await this.post('account/delete/finish', { challengeId: started['challengeId'], authorizationFinish: finished.finishLoginRequest,
      authorizationProof: await this.accountMac(finished.sessionKey, 'authorize', 'delete', started['challengeId'], { accountId: session.accountId, action: 'delete' }) });
    const { serverProof, ...claims } = result;
    if (serverProof !== await this.accountMac(finished.sessionKey, 'result', 'delete', started['challengeId'], claims)
      || result['accountId'] !== session.accountId || result['deleted'] !== true) return fail();
  }

  async logout(token: string): Promise<void> { await this.post('logout', { token }); }
}
