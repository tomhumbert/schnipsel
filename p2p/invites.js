/**
 * Friend handshake — invite / response codes.
 *
 * Adding a friend is a deliberate, MUTUAL, two-step exchange so that a leaked
 * invite link can never silently add a stranger:
 *
 *   1. Alice runs "Add friend" → gets an INVITE code, shares it over any channel.
 *   2. Bob pastes Alice's invite → sees her profile + fingerprint → Accept →
 *      Bob gets a RESPONSE code, sends it back to Alice. (Bob now trusts Alice.)
 *   3. Alice pastes Bob's response → sees his profile + fingerprint → Confirm.
 *      (Alice now trusts Bob.) Done.
 *
 * Every code is SIGNED by its author and carries their public keys. On receipt we
 * verify (a) the signature and (b) that the claimed fingerprint is the hash of the
 * embedded signing key — so the name/keys/fingerprint can't be mismatched or forged.
 * The invite also carries a one-time, expiring token; confirming a response checks
 * the token against an invite *we* actually created and consumes it.
 *
 * Codes are just text (base64url of signed JSON) — shareable through any channel.
 *
 * Exposes a global `invites` object. Runs in the background; uses `identity`+`store`.
 */

const invites = (() => {
  const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const MAX_CODE_LEN = 512 * 1024;               // reject oversized codes before parse
  const PREFIX = "schnipsel-friend:";            // human marker; stripped on parse

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // --- base64url <-> object ---
  function b64urlEncode(obj) {
    const bytes = enc.encode(JSON.stringify(obj));
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(dec.decode(bytes));
  }

  // Deterministic JSON (sorted keys) so signer and verifier hash identical bytes.
  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }

  function validJwk(jwk) {
    return jwk && jwk.kty === "EC" && jwk.crv === "P-256" &&
      typeof jwk.x === "string" && typeof jwk.y === "string";
  }

  // Validate the untrusted shape of a peer's identity block. Throws on anything off.
  function requirePartyShape(from) {
    if (!from || typeof from !== "object") throw new Error("Malformed code.");
    if (!/^[0-9a-f]{64}$/.test(from.fingerprint || "")) throw new Error("Bad fingerprint.");
    if (!validJwk(from.signPubJwk) || !validJwk(from.ecdhPubJwk)) throw new Error("Bad public keys.");
    if (from.name != null && typeof from.name !== "string") throw new Error("Bad name.");
    if (from.avatar != null && typeof from.avatar !== "string") throw new Error("Bad avatar.");
  }

  // Our own identity block to embed in a code.
  async function selfParty() {
    const pub = await identity.ensure();
    const profile = await store.getProfile();
    return {
      fingerprint: pub.fingerprint,
      signPubJwk: pub.signPubJwk,
      ecdhPubJwk: pub.ecdhPubJwk,
      name: store.cleanDisplayName(profile.name),
      avatar: profile.avatar || "",
    };
  }

  // Normalize an untrusted party for storage/display. A malformed avatar is dropped
  // (not fatal) so a friend with a bad picture can still be added.
  function normalizeParty(from) {
    let avatar = "";
    try { avatar = store.validateAvatar(from.avatar); } catch (_) { avatar = ""; }
    return {
      fingerprint: from.fingerprint,
      signPubJwk: from.signPubJwk,
      ecdhPubJwk: from.ecdhPubJwk,
      name: store.cleanDisplayName(from.name),
      avatar,
    };
  }

  // Decode + fully verify a code. Returns { kind, raw, party } or throws.
  async function decodeAndVerify(code) {
    if (typeof code !== "string") throw new Error("No code provided.");
    let body = code.trim();
    if (body.startsWith(PREFIX)) body = body.slice(PREFIX.length);
    body = body.trim();
    if (body.length === 0) throw new Error("Empty code.");
    if (body.length > MAX_CODE_LEN) throw new Error("Code is too large.");

    let obj;
    try { obj = b64urlDecode(body); } catch (_) { throw new Error("That code isn't valid."); }
    if (!obj || (obj.t !== "schnipsel-invite" && obj.t !== "schnipsel-response")) {
      throw new Error("Unrecognized code.");
    }
    if (obj.v !== 1) throw new Error("Unsupported code version.");
    if (typeof obj.sig !== "string") throw new Error("Missing signature.");
    if (typeof obj.token !== "string" || obj.token.length === 0 || obj.token.length > 256) {
      throw new Error("Bad token.");
    }
    requirePartyShape(obj.from);

    // Fingerprint must be the hash of the embedded signing key — binds name↔key.
    const expected = await identity.fingerprintOf(obj.from.signPubJwk);
    if (expected !== obj.from.fingerprint) throw new Error("Fingerprint doesn't match key.");

    // Verify the signature over everything except the signature itself.
    const { sig, ...signed } = obj;
    const ok = await identity.verify(obj.from.signPubJwk, stableStringify(signed), sig);
    if (!ok) throw new Error("Signature check failed.");

    if (obj.t === "schnipsel-invite") {
      if (typeof obj.exp !== "number") throw new Error("Bad expiry.");
      if (obj.exp < Date.now()) throw new Error("This invite has expired.");
    }

    // Don't let someone add themselves.
    const me = await identity.getPublic();
    if (me && obj.from.fingerprint === me.fingerprint) throw new Error("That's your own code.");

    return {
      kind: obj.t === "schnipsel-invite" ? "invite" : "response",
      raw: obj,
      party: normalizeParty(obj.from),
    };
  }

  return {
    /** Create an invite code (and remember its token so we can match the reply). */
    async createInvite() {
      const from = await selfParty();
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      let bin = "";
      for (const b of tokenBytes) bin += String.fromCharCode(b);
      const token = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const exp = Date.now() + INVITE_TTL_MS;

      const payload = { t: "schnipsel-invite", v: 1, token, exp, from };
      const sig = await identity.sign(stableStringify(payload));
      await store.addPendingInvite(token, exp);
      return { code: PREFIX + b64urlEncode({ ...payload, sig }) };
    },

    /** Inspect a pasted code without committing — for the confirm UI. */
    async inspect(code) {
      const { kind, party } = await decodeAndVerify(code);
      return { kind, party: { fingerprint: party.fingerprint, name: party.name, avatar: party.avatar } };
    },

    /**
     * Accept someone's invite: trust them, and produce a response code to send back.
     */
    async acceptInvite(code) {
      const { kind, raw, party } = await decodeAndVerify(code);
      if (kind !== "invite") throw new Error("That's not an invite code.");

      const friend = await store.addFriend(party);

      const from = await selfParty();
      const payload = { t: "schnipsel-response", v: 1, token: raw.token, from };
      const sig = await identity.sign(stableStringify(payload));
      return { friend, responseCode: PREFIX + b64urlEncode({ ...payload, sig }) };
    },

    /**
     * Confirm a response to an invite we created: the token must match an unexpired
     * invite of ours (and is consumed). Trust them back.
     */
    async confirmResponse(code) {
      const { kind, raw, party } = await decodeAndVerify(code);
      if (kind !== "response") throw new Error("That's not a response code.");

      const valid = await store.consumePendingInvite(raw.token);
      if (!valid) throw new Error("No matching invite — it may have expired or already been used.");

      const friend = await store.addFriend(party);
      return { friend };
    },
  };
})();

if (typeof window !== "undefined") window.invites = invites;
