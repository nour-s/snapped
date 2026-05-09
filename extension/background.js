let canvasTabId = null;
let pendingCaptureResolve = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'openCanvas') {
    if (canvasTabId !== null) {
      chrome.tabs.get(canvasTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          canvasTabId = null;
          openCanvasTab(sendResponse);
        } else {
          chrome.tabs.update(canvasTabId, { active: true });
          chrome.windows.update(tab.windowId, { focused: true });
          sendResponse({ tabId: canvasTabId });
        }
      });
    } else {
      openCanvasTab(sendResponse);
    }
    return true; // async
  }

  if (msg.action === 'captureRegion') {
    // sender.tab is the canvas tab
    chrome.desktopCapture.chooseDesktopMedia(
      ['screen', 'window', 'tab'],
      sender.tab,
      (streamId) => {
        if (chrome.runtime.lastError || !streamId) {
          sendResponse({ error: 'cancelled' });
        } else {
          sendResponse({ streamId });
        }
      }
    );
    return true; // async
  }

  if (msg.action === 'captureTab') {
    // Capture the previously active tab (not the canvas tab itself)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs.find(t => t.id !== canvasTabId) || tabs[0];
      if (!tab) { sendResponse({ error: 'no tab' }); return; }
      chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (dataURL) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ dataURL });
        }
      });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === canvasTabId) canvasTabId = null;
});

function openCanvasTab(sendResponse) {
  chrome.tabs.create({ url: chrome.runtime.getURL('canvas/canvas.html') }, (tab) => {
    canvasTabId = tab.id;
    sendResponse({ tabId: tab.id });
  });
}
