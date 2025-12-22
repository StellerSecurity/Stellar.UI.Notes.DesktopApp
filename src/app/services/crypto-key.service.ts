import { Injectable } from '@angular/core';

export interface CipherBlobV1 {
    v: 1;
    iv_b64: string;      // 12-byte IV (base64)
    ct_b64: string;      // ciphertext+tag (base64)
    aad_b64?: string;    // optional (base64)
}

/* --------------------- Small helpers --------------------- */
const TEXT = new TextEncoder();

const enc = new TextEncoder();

// Derive a 256-bit key from password using PBKDF2-SHA256
async function deriveKey(password: string, saltB64: string, iterations = 300_000) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}

@Injectable({ providedIn: 'root' })
export class CryptoKeyService {
    /** Decrypted Master Key (AES-GCM 256), held in memory while unlocked */
    private mkKey: CryptoKey | null = null;

    private eakBytes: Uint8Array | null = null;
    private eakB64: string | null = null;

    // Base64 helpers
    private b64d(s: string): Uint8Array {
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    private zeroize(buf: Uint8Array | null) {
        if (!buf) return;
        for (let i = 0; i < buf.length; i++) buf[i] = 0;
    }


    /**
     * Import plaintext EAK (base64). Keeps it ONLY in RAM.
     * Call this after you’ve unwrapped the EAK from the server bundle.
     */
    async importEAK(eakB64: string): Promise<void> {
        if (typeof eakB64 !== 'string' || !eakB64.length) {
            throw new Error('EAK missing');
        }

        // Decode and basic sanity check
        const bytes = this.b64d(eakB64);
        if (bytes.length < 16) throw new Error('EAK too short'); // adjust if you know exact length

        // Zeroize any previous EAK before replacing
        this.zeroize(this.eakBytes);

        // Store in memory
        this.eakBytes = bytes;
        this.eakB64 = eakB64;

        // after you compute `bytes` from eakB64 and sanity-check length:
        this.mkKey = await crypto.subtle.importKey(
            'raw',
            bytes,                 // 32 bytes for AES-256
            'AES-GCM',
            false,
            ['encrypt','decrypt']
        );
    }

    /* --------------------- Encryption helpers --------------------- */

    /** Encrypt a UTF-8 string with the MK. Optionally bind AAD (e.g., note id). */
    async encryptText(plain: string, aad?: string): Promise<CipherBlobV1> {
        if (!this.mkKey) throw new Error('Locked');
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ad = aad ? TEXT.encode(aad) : undefined;
        const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: ad }, this.mkKey, TEXT.encode(plain));
        return {
            v: 1,
            iv_b64: b64encode(iv),
            ct_b64: b64encode(ct),
            aad_b64: ad ? b64encode(ad) : undefined,
        };
    }


}
