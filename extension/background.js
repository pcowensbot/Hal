// HAL Import — Background Service Worker
// Handles extension installation and permissions

chrome.runtime.onInstalled.addListener(() => {
  // Set default server URL on install
  chrome.storage.local.get(['halServer'], (result) => {
    if (!result.halServer) {
      chrome.storage.local.set({ halServer: 'http://localhost:3000' });
    }
  });
});
