/**
 * Background script — message router and toolbar toggle.
 *
 * Messages handled:
 *   CLIP_CREATED   ← content script  → forward to sidebar
 *   SAVE_CLIP      ← sidebar         → persist via store, update index
 *   GET_CLIPS      ← sidebar         → return all clips
 *   GET_BAGS       ← sidebar         → return all bags
 *   SAVE_BAG       ← sidebar         → persist bag
 *   DELETE_CLIP    ← sidebar         → remove clip
 *   DELETE_BAG     ← sidebar         → remove bag
 *   ADD_TO_BAG     ← sidebar         → add clip to bag
 *   REMOVE_FROM_BAG← sidebar         → remove clip from bag
 */

// Toggle sidebar when the toolbar button is clicked.
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// Generate the cryptographic identity on first run (idempotent). Everything P2P
// hangs off this keypair, so make sure it exists as early as possible.
identity.ensure().catch((err) => console.error("Schnipsel: identity init failed", err));

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error("Schnipsel background error:", err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

// Only the extension's own pages (sidebar, collage tab) may invoke sensitive
// operations. A content script runs inside an arbitrary web page; its `sender.url`
// is that page's http(s) URL, whereas an extension page's is moz-extension://<id>/.
// Gating on this stops a hostile page (via a compromised content script) from
// reading the user's clips, triggering imports, or — once P2P lands — driving
// friend/identity/key operations.
function isTrustedSender(sender) {
  return !!(
    sender &&
    sender.id === browser.runtime.id &&
    typeof sender.url === "string" &&
    sender.url.startsWith(browser.runtime.getURL(""))
  );
}

// The only message type a content script is allowed to send. Everything else
// must originate from a trusted extension page.
const CONTENT_SCRIPT_MESSAGES = new Set(["CLIP_CREATED"]);

async function handleMessage(message, sender) {
  if (!CONTENT_SCRIPT_MESSAGES.has(message.type) && !isTrustedSender(sender)) {
    return { error: "Unauthorized sender for message: " + message.type };
  }

  switch (message.type) {
    case "CLIP_CREATED": {
      // Forward the unsaved clip to the sidebar so it can prompt the user
      // to choose a bag before saving.
      const views = browser.extension.getViews({ type: "sidebar" });
      for (const view of views) {
        view.postMessage({ type: "CLIP_PREVIEW", clip: message.clip });
      }
      return { ok: true };
    }

    case "SAVE_CLIP": {
      const id = await store.saveClip(message.clip);
      await index.addClip({ id, ...message.clip });
      return { id };
    }

    case "GET_CLIPS": {
      const clips = await store.getAllClips();
      return { clips };
    }

    case "GET_BAGS": {
      const bags = await store.getBags();
      return { bags };
    }

    case "SAVE_BAG": {
      const bag = await store.saveBag(message.bag);
      return { bag };
    }

    case "DELETE_CLIP": {
      await store.deleteClip(message.clipId);
      await index.removeClip(message.clipId);
      return { ok: true };
    }

    case "DELETE_BAG": {
      await store.deleteBag(message.bagId);
      return { ok: true };
    }

    case "BAG_SET_VISIBILITY": {
      const bag = await store.setBagVisibility(message.bagId, message.visibility);
      return { bag };
    }

    case "ADD_TO_BAG": {
      await store.addClipToBag(message.clipId, message.bagId);
      return { ok: true };
    }

    case "REMOVE_FROM_BAG": {
      await store.removeClipFromBag(message.clipId, message.bagId);
      return { ok: true };
    }

    case "SEARCH": {
      // Federated: local clips + selected friends' public-bag clips. Resolves each
      // provenance-tagged ref to its full clip record so the UI can render friend
      // clips it can't otherwise fetch.
      const refs = await index.federatedSearch(message.query, message.peers || null);
      const results = [];
      let ownMap = null;
      const friendCache = {};
      for (const ref of refs) {
        if (ref.owner === "me") {
          if (!ownMap) {
            const all = await store.getAllClips();
            ownMap = Object.fromEntries(all.map((c) => [c.id, c]));
          }
          const clip = ownMap[ref.clipId];
          if (clip) results.push({ owner: { kind: "me" }, clip });
        } else {
          if (!friendCache[ref.owner]) {
            const clips = await store.getFriendClips(ref.owner);
            const friend = await store.getFriend(ref.owner);
            friendCache[ref.owner] = {
              map: Object.fromEntries(clips.map((c) => [c.id, c])),
              friend,
            };
          }
          const { map, friend } = friendCache[ref.owner];
          const clip = map[ref.clipId];
          if (clip) {
            results.push({
              owner: { kind: "friend", fingerprint: ref.owner, name: friend?.name || "", avatar: friend?.avatar || "" },
              clip,
            });
          }
        }
      }
      return { results };
    }

    case "GET_PEERS": {
      // For the advanced-search peer picker.
      const me = await store.getProfile();
      const friends = await store.getFriends();
      return {
        me: { name: me.name, avatar: me.avatar },
        friends: friends.map((f) => ({ fingerprint: f.fingerprint, name: f.name, avatar: f.avatar })),
      };
    }

    case "EXPORT_DATA": {
      const data = await store.exportData(message.bagIds || null);
      return { data };
    }

    case "IMPORT_DATA": {
      const result = await store.importData(message.data);
      // Rebuild search entries for every restored clip.
      for (const clip of result.restoredClips) {
        await index.addClip(clip);
      }
      // Don't ship the clip blobs back to the sidebar.
      delete result.restoredClips;
      return result;
    }

    case "GET_IDENTITY": {
      // Public identity (fingerprint + public keys) + the local profile, for the UI.
      const pub = await identity.ensure();
      const profile = await store.getProfile();
      return { identity: pub, profile };
    }

    case "GET_PROFILE": {
      return { profile: await store.getProfile() };
    }

    case "SAVE_PROFILE": {
      const profile = await store.saveProfile(message.profile || {});
      return { profile };
    }

    case "GET_FRIENDS": {
      return { friends: await store.getFriends() };
    }

    case "CREATE_INVITE": {
      return await invites.createInvite();
    }

    case "INSPECT_CODE": {
      // Validate a pasted invite/response and report who it's from (no commit).
      return await invites.inspect(message.code);
    }

    case "ACCEPT_INVITE": {
      return await invites.acceptInvite(message.code);
    }

    case "CONFIRM_RESPONSE": {
      return await invites.confirmResponse(message.code);
    }

    case "REMOVE_FRIEND": {
      await store.removeFriend(message.fingerprint);
      return { ok: true };
    }

    case "SHARE_BAG": {
      // Build an encrypted share code for a public bag, addressed to chosen friends.
      return await transport.buildBundle(message.bagId, message.recipients || []);
    }

    case "RECEIVE_BUNDLE": {
      // Verify + decrypt + sanitize + store a received bundle.
      return await transport.ingestBundle(message.code);
    }

    case "GET_FRIEND_BAGS": {
      return { friendBags: await store.getFriendBagsList() };
    }

    case "ACTIVATE_PICKER": {
      // Forward to the active tab's content script
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await browser.tabs.sendMessage(tabs[0].id, { type: "ACTIVATE_PICKER" });
      }
      return { ok: true };
    }

    default:
      return { error: "Unknown message type: " + message.type };
  }
}
