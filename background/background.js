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

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((err) => {
    console.error("Schnipsel background error:", err);
    sendResponse({ error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(message, sender) {
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

    case "ADD_TO_BAG": {
      await store.addClipToBag(message.clipId, message.bagId);
      return { ok: true };
    }

    case "REMOVE_FROM_BAG": {
      await store.removeClipFromBag(message.clipId, message.bagId);
      return { ok: true };
    }

    case "SEARCH": {
      const results = await index.search(message.query);
      return { results };
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
