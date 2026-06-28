# Cryptographic Identity

Source file: `crypto/identity.js`

Each Schnipsel installation has a long-term cryptographic identity. This identity is the *real* identifier for a user in the P2P system — a display name and avatar are self-asserted labels that are bound to the key, but the fingerprint derived from the key is what uniquely and unforgeably identifies you.

---

## Keypairs

Two keypairs are generated on first run via `identity.ensure()` (idempotent):

### Signing keypair — ECDSA P-256

Used to sign everything that is shared:
- Invite codes
- Invite response codes
- Bag bundle envelopes

Signing uses SHA-256 as the hash algorithm. Signatures are produced with `crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, …)`.

### Key-agreement keypair — ECDH P-256

Used to derive a shared AES-GCM key with a specific peer (via HKDF). This key encrypts the content of bag bundles so only the addressed recipients can read them.

---

## Non-extractable private keys

Private keys are stored in a **separate IndexedDB database** (`schnipsel-keys`, store `keys`) and are **non-extractable**:

```js
// Generated as extractable to get the JWK, then re-imported as non-extractable
const privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const priv = await crypto.subtle.importKey("jwk", privJwk, algo, false, privUsages);
//                                                              ↑
//                                                         extractable = false
```

Once stored, the private key material can never be read back out — not by the extension itself, not by a successful XSS, not by any script on the page. An attacker who gains code execution in the extension context can *call* `identity.sign()` and `identity.encryptFor()`, but cannot steal the raw key bytes.

The public keys are mirrored to `storage.local["identityPub"]` for quick reads without opening the key database on every operation.

---

## Fingerprint

The fingerprint is the canonical identifier for an identity:

```js
async function fingerprintOf(signPubJwk) {
  const canon = JSON.stringify({
    kty: signPubJwk.kty, crv: signPubJwk.crv, x: signPubJwk.x, y: signPubJwk.y,
  });
  const h = await crypto.subtle.digest("SHA-256", enc.encode(canon));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
```

Only the curve point `(x, y)` coordinates are hashed, not the full JWK object (which can include optional fields). This produces a stable, canonical 64-character hex string.

The short fingerprint shown in the UI is the first 16 characters formatted as 4-character groups:

```js
identity.shortFingerprint(fp)  // "a1b2 c3d4 e5f6 a7b8"
```

The full fingerprint is shown for out-of-band comparison (e.g., calling a friend to verify you added the right person).

---

## Signing

```js
await identity.sign(dataString)  → base64 signature string
```

Signs a UTF-8 string representation of the data. All signed payloads use **deterministic (stable) JSON** — keys sorted alphabetically — so both the signer and verifier produce identical bytes from the same object:

```js
function stableStringify(value) {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}
```

The signature is computed over the payload object *without* the `sig` field. To verify, the verifier re-signs the received object minus its `sig`, and checks that the signature matches.

---

## Verification

```js
await identity.verify(signPubJwk, dataString, sigB64)  → boolean
```

Imports the peer's public signing key from JWK and verifies the signature. Returns `false` (never throws) on any failure — malformed key, invalid base64, wrong signature.

---

## Key derivation (ECDH → HKDF → AES-GCM)

```js
await identity.deriveAesKey(theirEcdhPubJwk, info)  → CryptoKey (AES-GCM 256)
```

The derivation is ECDH followed by HKDF:

1. Derive raw shared bits from our ECDH private key and their ECDH public key (256 bits).
2. Import the bits as HKDF keying material.
3. Derive a 256-bit AES-GCM key using HKDF with SHA-256, an empty salt, and a domain-separation label (`info`).

The label `"schnipsel-bundle-key-v1"` is used for bag bundle key wrapping. Different `info` values derive different keys from the same ECDH secret, providing domain separation between protocol uses.

---

## Encryption

```js
await identity.encryptFor(theirEcdhPubJwk, plaintext, info)  → { iv: base64, ct: base64 }
await identity.decryptFrom(theirEcdhPubJwk, { iv, ct }, info)  → plaintext string
```

Standard AES-GCM encryption with a random 96-bit IV. The authentication tag (embedded in the GCM ciphertext) guarantees both confidentiality and integrity. `decryptFrom` throws if the tag fails — the caller catches this and reports a decryption error without leaking details.

---

## Runtime safety

The `identity` object is initialized in the background page only. UI pages (sidebar, collage) reach it via `browser.runtime.sendMessage` — they never hold the private keys themselves. The background runs in a non-persistent context (event page) and reloads the keys from IDB each time it is activated.

The in-memory cache (`let cached = null`) avoids repeated IDB lookups within a single background activation. On the next background wake, `cached` is null again and keys are re-loaded.

---

## Public API

```js
identity.ensure()                  // generate on first run; idempotent; returns public half
identity.getPublic()               → { fingerprint, signPubJwk, ecdhPubJwk, createdAt }
identity.fingerprintOf(signPubJwk) → hex string (64 chars)
identity.shortFingerprint(fp)      → "xxxx xxxx xxxx xxxx" (first 16 chars, grouped)
identity.sign(dataString)          → base64 signature
identity.verify(signPubJwk, dataString, sigB64)  → boolean
identity.deriveAesKey(theirEcdhPubJwk, info)     → CryptoKey
identity.encryptFor(theirEcdhPubJwk, plaintext, info)  → { iv, ct }
identity.decryptFrom(theirEcdhPubJwk, { iv, ct }, info) → plaintext
```
