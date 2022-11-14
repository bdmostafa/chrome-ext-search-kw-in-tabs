'use strict';

const cache = {};
chrome.tabs.onRemoved.addListener(tabId => delete cache[tabId]);

chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'find') {
    chrome.tabs.update(request.tabId, {
      active: true
    });
    chrome.windows.update(request.windowId, {
      focused: true
    });
    chrome.storage.local.get({
      strict: false
    }, prefs => {
      if (request.snippet && (request.snippet.indexOf('<b>') !== -1 || prefs.strict)) {
        cache[request.tabId] = request;
        chrome.scripting.executeScript({
          target: {
            tabId: request.tabId,
            allFrames: true
          },
          files: ['data/highlight.js']
        }, () => chrome.runtime.lastError);
      }
      response();
    });
  }
  else if (request.method === 'get') {
    response(cache[sender.tab.id]);
    cache[sender.tab.id];
  }
});

/* action */
chrome.action.onClicked.addListener(tab => chrome.tabs.create({
  url: `data/popup/index.html?mode=tab`,
  index: tab.index + 1
}));
{
  const startup = () => chrome.storage.local.get({
    'open-mode': 'popup'
  }, prefs => {
    chrome.action.setPopup({
      popup: prefs['open-mode'] === 'popup' ? 'data/popup/index.html' : ''
    });
  });
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
}
chrome.storage.onChanged.addListener(ps => {
  if (ps['open-mode']) {
    chrome.action.setPopup({
      popup: ps['open-mode'].newValue === 'popup' ? 'data/popup/index.html' : ''
    });
  }
});
