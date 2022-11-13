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

// Context Menu
{
  const startup = () => chrome.storage.local.get({
    'mode': 'none',
    'scope': 'both',
    'index': 'browser', // 'browser', 'window', tab'
    'engine': 'xapian',
    'strict': false,
    'duplicates': true,
    'parse-pdf': true,
    'fetch-timeout': 10000, // ms
    'max-content-length': 100 * 1024, // bytes
    'search-size': 30,
    'snippet-size': 300,
    'highlight-color': 'orange',
    'open-mode': 'popup'
  }, prefs => {
    chrome.contextMenus.create({
      id: 'automatic-search',
      title: 'Auto Search',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      type: 'radio',
      id: 'mode:selectedORhistory',
      title: 'Selected text or last query',
      contexts: ['action'],
      checked: prefs.mode === 'selectedORhistory',
      parentId: 'automatic-search'
    });
  });
  chrome.runtime.onStartup.addListener(startup);
  chrome.runtime.onInstalled.addListener(startup);
}

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'strict' || info.menuItemId === 'duplicates' || info.menuItemId === 'parse-pdf') {
    chrome.storage.local.set({
      [info.menuItemId]: info.checked
    });
  }
  else if (info.menuItemId.startsWith('fetch-timeout-')) {
    const timeout = Number(info.menuItemId.replace('fetch-timeout-', ''));
    chrome.storage.local.set({
      'fetch-timeout': timeout
    });
  }
  else if (info.menuItemId.startsWith('max-content-length-')) {
    const bytes = Number(info.menuItemId.replace('max-content-length-', ''));
    chrome.storage.local.set({
      'max-content-length': bytes
    });
  }
  else if (info.menuItemId.startsWith('scope:')) {
    chrome.storage.local.set({
      scope: info.menuItemId.replace('scope:', '')
    });
  }
  else if (info.menuItemId.startsWith('index:')) {
    chrome.storage.local.set({
      index: info.menuItemId.replace('index:', '')
    });
  }
  else if (info.menuItemId.startsWith('engine:')) {
    chrome.storage.local.set({
      engine: info.menuItemId.replace('engine:', '')
    });
  }
  else if (info.menuItemId.startsWith('search:')) {
    chrome.storage.local.set({
      'search-size': Number(info.menuItemId.replace('search:', ''))
    });
  }
  else if (info.menuItemId.startsWith('snippet:')) {
    chrome.storage.local.set({
      'snippet-size': Number(info.menuItemId.replace('snippet:', ''))
    });
  }
  else if (info.menuItemId.startsWith('highlight:')) {
    chrome.storage.local.set({
      'highlight-color': info.menuItemId.replace('highlight:', '')
    });
  }
  else if (info.menuItemId.startsWith('open-mode:')) {
    chrome.storage.local.set({
      'open-mode': info.menuItemId.replace('open-mode:', '')
    });
  }
  else {
    chrome.storage.local.set({
      mode: info.menuItemId.replace('mode:', '')
    });
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
