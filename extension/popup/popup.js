document.getElementById('open').addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'openCanvas' }, () => window.close());
});
