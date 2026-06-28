/**
 * Sharing transport — signed, encrypted bag "bundles".
 *
 * A public bag is shared as a single text code (base64url of a signed JSON
 * envelope) that can travel over any channel. The transport is deliberately
 * pluggable: today it produces/consumes a string; a WebRTC or relay backend can
 * later move the same bundles without touching the security pipeline.
 *
 * ENVELOPE (signed by the sender, encrypted to each recipient):
 *   { t:"schnipsel-bundle", v, sender:{fingerprint,signPubJwk,ecdhPubJwk},
 *     recipients:[{fingerprint, iv, wrappedKey}], iv, ciphertext, sentAt, sig }
 *   - A random AES-GCM "content key" encrypts the payload once (`ciphertext`).
 *   - That content key is wrapped per recipient via an ECDH-derived key, so only
 *     an addressed friend can unwrap it. (One entry today; ready for many.)
 *   - The whole envelope is ECDSA-signed → authenticity + integrity.
 *
 * INGEST PIPELINE (fail-closed at every step, in this order):
 *   1. size + schema validation
 *   2. sender is a known friend AND its keys match the ones we stored
 *   3. signature verifies (and fingerprint == hash of signing key)
 *   4. the bundle is addressed to us → unwrap content key → decrypt payload
 *   5. monotonic version check (reject replays of stale bundles)
 *   6. per-clip: recompute SHA-256(html+sourceUrl) == claimed id  (tamper-evident)
 *   7. DOMPurify-sanitize + strip remote refs (no scripts, no tracking beacons)
 *   8. store friend-namespaced, under a per-friend quota; rebuild friend index
 *
 * Exposes a global `transport` object. Uses identity, store, index, sanitize.
 */

const transport = (() => {
  const PREFIX = "schnipsel-bag:";
  const KEY_INFO = "schnipsel-bundle-key-v1"; // ECDH-derive label for key wrapping
  const MAX_BUNDLE_BYTES = 12 * 1024 * 1024;  // reject oversized codes before parse
  const MAX_BUNDLE_CLIPS = 1000;
  const MAX_CLIP_HTML = 1024 * 1024;          // 1 MB per clip
  const MAX_INDEXTOKENS_BYTES = 64 * 1024;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // --- byte/base64 helpers ---
  function bufToB64(buf) {
    const b = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64ToBuf(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function b64urlEncodeObj(obj) {
    return bufToB64(enc.encode(JSON.stringify(obj)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecodeObj(str) {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(dec.decode(b64ToBuf(b64)));
  }

  function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }

  // Must match storage/store.js: id = hex(SHA-256(html + sourceUrl)).
  async function contentHash(html, sourceUrl) {
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(html + sourceUrl));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // --- raw AES-GCM with a given CryptoKey ---
  async function aesEncrypt(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    return { iv: bufToB64(iv), ct: bufToB64(ct) };
  }
  async function aesDecrypt(key, ivB64, ctB64) {
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(ivB64) }, key, b64ToBuf(ctB64)));
  }

  function validJwk(j) {
    return j && j.kty === "EC" && j.crv === "P-256" &&
      typeof j.x === "string" && typeof j.y === "string";
  }
  function jwkEq(a, b) {
    return a && b && a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y;
  }

  return {
    /**
     * Build a share code for a PUBLIC bag, encrypted to the given friend
     * fingerprints. Returns { code, recipientCount }.
     */
    async buildBundle(bagId, recipientFingerprints) {
      const bag = (await store.getBags()).find((b) => b.id === bagId);
      if (!bag) throw new Error("Bag not found.");
      if (bag.visibility !== "public") throw new Error("Only public bags can be shared.");

      const friends = await store.getFriends();
      const byFp = Object.fromEntries(friends.map((f) => [f.fingerprint, f]));
      const recipients = (recipientFingerprints || [])
        .map((fp) => byFp[fp]).filter(Boolean);
      if (recipients.length === 0) throw new Error("Pick at least one friend to share with.");

      const allClips = await store.getAllClips();
      const clips = allClips
        .filter((c) => (bag.clipIds || []).includes(c.id))
        .map((c) => ({
          id: c.id, html: c.html, sourceUrl: c.sourceUrl,
          pageTitle: c.pageTitle, indexTokens: c.indexTokens,
        }));

      const payload = {
        bag: { id: bag.id, name: bag.name, version: bag.version, visibility: "public" },
        clips,
        sentAt: Date.now(),
      };

      // Encrypt the payload once with a fresh content key.
      const contentKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      const body = await aesEncrypt(contentKey, enc.encode(JSON.stringify(payload)));
      const rawKey = new Uint8Array(await crypto.subtle.exportKey("raw", contentKey));

      // Wrap the content key for each recipient via an ECDH-derived key.
      const recipientsOut = [];
      for (const f of recipients) {
        const kR = await identity.deriveAesKey(f.ecdhPubJwk, KEY_INFO);
        const wrapped = await aesEncrypt(kR, rawKey);
        recipientsOut.push({ fingerprint: f.fingerprint, iv: wrapped.iv, wrappedKey: wrapped.ct });
      }

      const me = await identity.getPublic();
      const envelope = {
        t: "schnipsel-bundle",
        v: 1,
        sender: { fingerprint: me.fingerprint, signPubJwk: me.signPubJwk, ecdhPubJwk: me.ecdhPubJwk },
        recipients: recipientsOut,
        iv: body.iv,
        ciphertext: body.ct,
        sentAt: payload.sentAt,
      };
      const sig = await identity.sign(stableStringify(envelope));
      return { code: PREFIX + b64urlEncodeObj({ ...envelope, sig }), recipientCount: recipients.length };
    },

    /**
     * Verify, decrypt, sanitize and store a received bundle. Returns a summary
     * { friend, bagName, clipCount }. Throws (without storing anything) on the
     * first failed check.
     */
    async ingestBundle(code) {
      if (typeof code !== "string") throw new Error("No bundle provided.");
      let body = code.trim();
      if (body.startsWith(PREFIX)) body = body.slice(PREFIX.length);
      body = body.trim();
      if (body.length === 0) throw new Error("Empty bundle.");
      if (body.length > MAX_BUNDLE_BYTES) throw new Error("Bundle is too large.");

      let env;
      try { env = b64urlDecodeObj(body); } catch (_) { throw new Error("That bundle isn't valid."); }

      // 1. schema
      if (!env || env.t !== "schnipsel-bundle" || env.v !== 1) throw new Error("Unrecognized bundle.");
      if (typeof env.sig !== "string") throw new Error("Missing signature.");
      if (typeof env.iv !== "string" || typeof env.ciphertext !== "string") throw new Error("Malformed bundle.");
      if (!Array.isArray(env.recipients)) throw new Error("Malformed bundle.");
      const s = env.sender;
      if (!s || !/^[0-9a-f]{64}$/.test(s.fingerprint || "") || !validJwk(s.signPubJwk) || !validJwk(s.ecdhPubJwk)) {
        throw new Error("Malformed sender.");
      }

      // 2. sender must be a known friend, with the SAME keys we stored for them
      const friend = await store.getFriend(s.fingerprint);
      if (!friend) throw new Error("This bundle is from someone who isn't your friend.");
      if (!jwkEq(friend.signPubJwk, s.signPubJwk) || !jwkEq(friend.ecdhPubJwk, s.ecdhPubJwk)) {
        throw new Error("Sender keys don't match your saved friend — refusing.");
      }

      // 3. fingerprint binds to the signing key, and the signature verifies
      const expectedFp = await identity.fingerprintOf(s.signPubJwk);
      if (expectedFp !== s.fingerprint) throw new Error("Sender fingerprint mismatch.");
      const { sig, ...signed } = env;
      if (!(await identity.verify(s.signPubJwk, stableStringify(signed), sig))) {
        throw new Error("Bundle signature check failed.");
      }

      // 4. addressed to us → unwrap content key → decrypt payload
      const me = await identity.getPublic();
      const myRec = env.recipients.find((r) => r && r.fingerprint === me.fingerprint);
      if (!myRec || typeof myRec.iv !== "string" || typeof myRec.wrappedKey !== "string") {
        throw new Error("This bundle wasn't shared with you.");
      }
      const kR = await identity.deriveAesKey(s.ecdhPubJwk, KEY_INFO);
      let rawKey, payload;
      try {
        rawKey = await aesDecrypt(kR, myRec.iv, myRec.wrappedKey);
        const contentKey = await crypto.subtle.importKey(
          "raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
        const ptBytes = await aesDecrypt(contentKey, env.iv, env.ciphertext);
        payload = JSON.parse(dec.decode(ptBytes));
      } catch (_) {
        throw new Error("Couldn't decrypt this bundle.");
      }

      // payload schema + caps
      const bag = payload && payload.bag;
      if (!bag || typeof bag.id !== "string" || typeof bag.version !== "number") {
        throw new Error("Malformed bundle contents.");
      }
      if (!Array.isArray(payload.clips)) throw new Error("Malformed bundle contents.");
      if (payload.clips.length > MAX_BUNDLE_CLIPS) throw new Error("Bundle has too many clips.");

      // 5. replay protection — never accept an older/equal bag version
      const existing = (await store.getFriendBags())[s.fingerprint]?.[bag.id];
      if (existing && bag.version <= existing.version) {
        throw new Error("You already have this bag at the same or newer version.");
      }

      // 6 + 7. per-clip integrity check, then sanitize
      const sanitizedClips = [];
      for (const clip of payload.clips) {
        if (!clip || typeof clip.id !== "string" || typeof clip.html !== "string" ||
            typeof clip.sourceUrl !== "string") {
          throw new Error("Malformed clip in bundle.");
        }
        if (clip.html.length > MAX_CLIP_HTML) throw new Error("A clip is too large.");

        const computed = await contentHash(clip.html, clip.sourceUrl);
        if (computed !== clip.id) throw new Error("A clip failed its integrity check.");

        let indexTokens = clip.indexTokens || null;
        if (indexTokens && JSON.stringify(indexTokens).length > MAX_INDEXTOKENS_BYTES) {
          indexTokens = null; // oversized token blob — drop it rather than store it
        }

        sanitizedClips.push({
          id: clip.id,
          html: sanitize.clip(clip.html, { allowRemote: false }), // strip script + remote refs
          sourceUrl: clip.sourceUrl,
          pageTitle: typeof clip.pageTitle === "string" ? clip.pageTitle.slice(0, 300) : "",
          indexTokens,
        });
      }

      // 8. store (quota enforced) + rebuild this friend's namespaced index
      const saved = await store.saveSharedBagClips(s.fingerprint, bag, sanitizedClips);
      const allFriendClips = await store.getFriendClips(s.fingerprint);
      await store.setFriendIndex(s.fingerprint, index.buildMap(allFriendClips));

      return { friend, bagName: saved.name, clipCount: sanitizedClips.length };
    },
  };
})();

if (typeof window !== "undefined") window.transport = transport;
