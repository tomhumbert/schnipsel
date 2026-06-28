/**
 * Cryptographic identity — the user's long-term keypairs and the sign / verify /
 * encrypt / decrypt primitives the P2P layer is built on.
 *
 * A user's *identity* is a keypair, never a name. Display name + avatar (see the
 * "profile" in storage/store.js) are self-asserted labels bound to this key; the
 * key fingerprint is the real, unforgeable identifier shown in the UI.
 *
 *   - ECDSA P-256 (SHA-256) — signs every shared artifact (invites, bag bundles).
 *   - ECDH  P-256 + HKDF    — derives an AES-GCM key shared with a peer, used to
 *                              encrypt public-bag bundles so only friends can read.
 *
 * Private keys are stored **non-extractable** in IndexedDB: even a successful XSS
 * could call sign/encrypt but could never read out the raw key material.
 *
 * This module runs in the background page only (the single authoritative holder of
 * the private keys). UI pages reach it through background message handlers.
 *
 * Exposes a global `identity` object (project no-module convention).
 */

const identity = (() => {
  const KEY_DB = "schnipsel-keys";
  const KEY_STORE = "keys";
  const PUB_CACHE = "identityPub"; // public half mirrored to storage.local for quick reads

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // --- base64 helpers (compact, transport-safe) ---
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBuf(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  // --- dedicated IDB for keys (kept apart from clips; never exported) ---
  function openKeyDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(KEY_DB, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }
  async function keyPut(record) {
    const db = await openKeyDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, "readwrite");
      tx.objectStore(KEY_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }
  async function keyGet(id) {
    const db = await openKeyDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, "readonly");
      const req = tx.objectStore(KEY_STORE).get(id);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  // Generate a pair, export the public JWK, and re-import the private half as
  // NON-extractable so what we persist can never be read back out.
  async function genPair(algo, privUsages, pubUsages) {
    const pair = await crypto.subtle.generateKey(algo, true, [...privUsages, ...pubUsages]);
    const pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const priv = await crypto.subtle.importKey("jwk", privJwk, algo, false, privUsages);
    return { pubJwk, priv };
  }

  async function fingerprintOf(signPubJwk) {
    // Canonical form over only the curve point so the fingerprint is stable.
    const canon = JSON.stringify({
      kty: signPubJwk.kty, crv: signPubJwk.crv, x: signPubJwk.x, y: signPubJwk.y,
    });
    const h = await crypto.subtle.digest("SHA-256", enc.encode(canon));
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  let cached = null; // in-memory {signPriv, ecdhPriv, signPubJwk, ecdhPubJwk, fingerprint}

  async function load() {
    if (cached) return cached;
    const sign = await keyGet("signing");
    const ecdh = await keyGet("ecdh");
    if (!sign || !ecdh) return null;
    cached = {
      signPriv: sign.priv,
      ecdhPriv: ecdh.priv,
      signPubJwk: sign.pubJwk,
      ecdhPubJwk: ecdh.pubJwk,
      fingerprint: sign.fingerprint,
    };
    return cached;
  }

  return {
    /** Generate the identity on first run; idempotent. Returns the public half. */
    async ensure() {
      const existing = await load();
      if (existing) return identity.getPublic();

      const signing = await genPair({ name: "ECDSA", namedCurve: "P-256" }, ["sign"], ["verify"]);
      const ecdh = await genPair({ name: "ECDH", namedCurve: "P-256" }, ["deriveKey", "deriveBits"], []);
      const fingerprint = await fingerprintOf(signing.pubJwk);

      await keyPut({ id: "signing", priv: signing.priv, pubJwk: signing.pubJwk, fingerprint });
      await keyPut({ id: "ecdh", priv: ecdh.priv, pubJwk: ecdh.pubJwk });

      cached = {
        signPriv: signing.priv, ecdhPriv: ecdh.priv,
        signPubJwk: signing.pubJwk, ecdhPubJwk: ecdh.pubJwk, fingerprint,
      };

      const pub = { fingerprint, signPubJwk: signing.pubJwk, ecdhPubJwk: ecdh.pubJwk, createdAt: Date.now() };
      await browser.storage.local.set({ [PUB_CACHE]: pub });
      return pub;
    },

    /** Public half of our identity, safe to share. */
    async getPublic() {
      const me = await load();
      if (!me) return null;
      const { [PUB_CACHE]: cachedPub } = await browser.storage.local.get(PUB_CACHE);
      return {
        fingerprint: me.fingerprint,
        signPubJwk: me.signPubJwk,
        ecdhPubJwk: me.ecdhPubJwk,
        createdAt: cachedPub?.createdAt || null,
      };
    },

    fingerprintOf,

    /** Short, human-comparable form of a fingerprint (groups of 4 hex). */
    shortFingerprint(fp) {
      return (fp || "").slice(0, 16).match(/.{1,4}/g)?.join(" ") || "";
    },

    /** Sign a UTF-8 string; returns base64 signature. */
    async sign(dataString) {
      const me = await load();
      if (!me) throw new Error("No identity");
      const sig = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, me.signPriv, enc.encode(dataString));
      return bufToB64(sig);
    },

    /** Verify a base64 signature against a peer's signing public JWK. */
    async verify(signPubJwk, dataString, sigB64) {
      try {
        const pub = await crypto.subtle.importKey(
          "jwk", signPubJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        return await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" }, pub, b64ToBuf(sigB64), enc.encode(dataString));
      } catch (_) {
        return false;
      }
    },

    /** Derive a shared AES-GCM key with a peer (ECDH → HKDF). `info` separates uses. */
    async deriveAesKey(theirEcdhPubJwk, info = "schnipsel-v1") {
      const me = await load();
      if (!me) throw new Error("No identity");
      const theirPub = await crypto.subtle.importKey(
        "jwk", theirEcdhPubJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: theirPub }, me.ecdhPriv, 256);
      const hk = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) },
        hk, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    },

    /** Encrypt a UTF-8 string to a peer. Returns { iv, ct } as base64. */
    async encryptFor(theirEcdhPubJwk, plaintext, info) {
      const key = await this.deriveAesKey(theirEcdhPubJwk, info);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
      return { iv: bufToB64(iv), ct: bufToB64(ct) };
    },

    /** Decrypt { iv, ct } (base64) from a peer. Throws on auth-tag failure. */
    async decryptFrom(theirEcdhPubJwk, payload, info) {
      const key = await this.deriveAesKey(theirEcdhPubJwk, info);
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64ToBuf(payload.iv) }, key, b64ToBuf(payload.ct));
      return dec.decode(pt);
    },

    // Expose for the transport layer (per-recipient content-key wrapping in Phase 5).
    _b64: { enc: bufToB64, dec: b64ToBuf },
  };
})();

if (typeof window !== "undefined") window.identity = identity;
