/* Globals engine */
'use strict';

// Tests => PDF, discarded tab, about:blank, chrome://extensions/, google, webstore

const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = './parser/pdf.worker.js';

const args = new URLSearchParams(location.search);
document.body.dataset.mode = args.get('mode');

let ready = false;
let docs = 0;

let aid;
const arrange = () => {
  clearTimeout(aid);
  aid = setTimeout(arrange.do, 100);
};
arrange.do = () => {
  const es = [...document.querySelectorAll('.result')];
  const vs = es.filter(e => e.getBoundingClientRect().y > 5);
  // es.forEach((e, c) => {
  //   const n = e.querySelector('[data-id="number"]');
  //   const v = vs.length - es.length + c + 1;
  //   n.textContent = '#' + v;
  //   n.dataset.count = v;
  // });
};

// Keep tabs
const cache = {};

const index = (tab, scope = 'both', options = {}) => {
  const od = {
    body: '',
    date: new Date(document.lastModified).toISOString().split('T')[0].replace(/-/g, ''),
    description: '',
    frameId: 0,
    keywords: '',
    lang: 'english',
    mime: 'text/html',
    title: tab.title,
    url: tab.url,
    top: true
  };

  return Promise.race([new Promise(resolve => {
    chrome.scripting.executeScript({
      target: {
        tabId: tab.id,
        allFrames: true
      },
      files: ['/data/collect.js']
    }).catch(() => []).then(arr => {
      chrome.runtime.lastError;
      arr = (arr || []).filter(a => a && a.result).map(a => a.result);
      arr = (arr && arr.length ? arr : [od]).map(o => {
        o.title = o.title || tab.title;
        return o;
      });

      // Support parsing PDF files
      let parse = false;
      if (options['parse-pdf'] === true) {
        if (arr && tab.url && (arr[0].mime === 'application/pdf' || tab.url.indexOf('.pdf') !== -1)) {
          if (scope === 'both' || scope === 'body') {
            parse = true;
          }
        }
      }
      if (parse) {
        pdfjsLib.getDocument(tab.url).promise.then(pdf => {
          return Promise.all(Array.from(Array(pdf.numPages)).map(async (a, n) => {
            const page = await pdf.getPage(n + 1);
            const content = await page.getTextContent();
            return content.items.map(s => s.str).join('') + '\n\n' +
              content.items.map(s => s.str).join('\n');
          })).then(a => a.join('\n\n')).then(c => {
            arr[0].body = c;
            arr[0].pdf = true;
            resolve(arr);
          });
        }).catch(e => {
          console.warn('Cannot parse PDF document', tab.url, e);
          resolve(arr);
        });
      }
      else {
        resolve(arr);
      }
    });
  }), new Promise(resolve => setTimeout(() => {
    resolve([od]);
  }, options['fetch-timeout']))]).then(async arr => {
    try {
      arr = arr.filter(a => a && (a.title || a.body));

      for (const o of arr) {
        o.lang = engine.language(o.lang);
        o.title = o.title || tab.title || cache[tab.id].title;
        if (o.title) {
          cache[tab.id].title = o.title;
        }
        const favIconUrl = tab.favIconUrl || o.favIconUrl || cache[tab.id].favIconUrl;
        if (favIconUrl) {
          cache[tab.id].favIconUrl = o.title;
        }
        if (scope === 'body') {
          o.title = '';
        }
        else if (scope === 'title') {
          o.body = '';
        }
        if (options['max-content-length'] > 0) {
          o.body = o.body.slice(0, options['max-content-length']);
        }

        await engine.add(o, {
          tabId: tab.id,
          windowId: tab.windowId,
          favIconUrl: favIconUrl || 'web.svg',
          frameId: o.frameId,
          top: o.top,
          lang: o.lang
        });
      }
      return arr.length;
    }
    catch (e) {
      console.warn('document skipped', e);
      if (e.message.includes('memory access out of bounds')) {
        return -1;
      }
      return 0;
    }
  });
};

document.addEventListener('engine-ready', async () => {
  const prefs = await (new Promise(resolve => chrome.storage.local.get({
    'scope': 'both',
    'index': 'browser',
    'parse-pdf': true,
    'fetch-timeout': 10000,
    'max-content-length': 100 * 1024,
    'duplicates': true,
    'highlight-color': 'orange'
  }, prefs => resolve(prefs))));

  const query = {};
  if (prefs.index === 'window' || prefs.index === 'tab') {
    query.currentWindow = true;
  }
  if (prefs.index === 'tab') {
    query.active = true;
  }
  let tabs = await chrome.tabs.query(query);
  tabs.forEach(tab => cache[tab.id] = tab);

  // Highlight color
  document.documentElement.style.setProperty(
    '--highlight-color',
    'var(--highlight-' + prefs['highlight-color'] + ')'
  );

  // Indexing and checking if duplication remains
  let ignored = 0;
  if (prefs.duplicates) {
    const list = new Set();
    tabs = tabs.filter(t => {
      if (list.has(t.url)) {
        ignored += 1;
        return false;
      }
      list.add(t.url);
      return true;
    });
  }

  let memory = false;
  docs = (await Promise.all(tabs.map(tab => index(tab, prefs.scope, {
    'parse-pdf': prefs['parse-pdf'],
    'fetch-timeout': prefs['fetch-timeout'],
    'max-content-length': prefs['max-content-length']
  })))).reduce((p, c) => {
    if (c === 0 || c === -1) {
      ignored += 1;
    }
    if (c === -1) {
      memory = true;
      return p;
    }
    else {
      return p + c;
    }
  }, 0);

  if (memory) {
    alert(`Your browser's memory limit for indexing content reached.

Right-click on the toolbar button and reduce the "Maximum Size of Each Content" option and retry.`);
    window.close();
  }
  if (docs === 0) {
    root.dataset.empty = 'Nothing to index. You need to have some tabs open.';
  }
  else {
    root.dataset.empty = `Searching among ${docs} document${docs === 1 ? '' : 's'}`;
    if (ignored) {
      root.dataset.empty += `. ${ignored} tab${ignored === 1 ? ' is' : 's are'} ignored.`;
    }
  }
  ready = true;
  // If we have anything to search
  const input = document.querySelector('#search input[type=search]');
  if (input.value) {
    input.dispatchEvent(new Event('input', {
      bubbles: true
    }));
  }
  else {
    chrome.storage.local.get({
      mode: 'none',
      query: ''
    }, prefs => {
      if (prefs.mode === 'selected' || prefs.mode === 'selectedORhistory') {
        // If we have selected text

        chrome.tabs.query({
          currentWindow: true,
          active: true
        }, ([tab]) => chrome.scripting.executeScript({
          target: {
            tabId: tab.id
          },
          func: () => {
            return window.getSelection().toString();
          }
        }, (arr = []) => {
          if (chrome.runtime.lastError || input.value) {
            return;
          }
          const query = arr.reduce((p, c) => p || c.result, '');
          if (query) {
            input.value = query;
            input.select();
            input.dispatchEvent(new Event('input', {
              bubbles: true
            }));
          }
          else if (prefs.mode === 'selectedORhistory' && prefs.query) {
            input.value = prefs.query;
            input.select();
            input.dispatchEvent(new Event('input', {
              bubbles: true
            }));
          }
        }));
      }
      else if (prefs.mode === 'history' && prefs.query) {
        input.value = prefs.query;
        input.select();
        input.dispatchEvent(new Event('input', {
          bubbles: true
        }));
      }
    });
  }
});

const root = document.getElementById('results');

document.getElementById('search').addEventListener('submit', e => {
  e.preventDefault();
});

const search = query => {
  // Abort all ongoing search requests
  for (const c of search.controllers) {
    c.abort();
  }
  search.controllers.length = 0;
  const controller = new AbortController();
  const {signal} = controller;
  search.controllers.push(controller);

  const info = document.getElementById('info');
  const start = Date.now();
  chrome.storage.local.get({
    'snippet-size': 300,
    'search-size': 30
  }, prefs => {
    if (signal.aborted) {
      return;
    }

    // Detect input language - English by default
    chrome.i18n.detectLanguage(query, async obj => {
      if (signal.aborted) {
        return;
      }
      const lang = engine.language(obj && obj.languages.length ? obj.languages[0].language : 'en');

      try {
        const {size, estimated} = await engine.search({
          query,
          lang,
          length: prefs['search-size']
        });

        document.body.dataset.size = size;

        if (size === 0) {
          info.textContent = '';
          return;
        }
        info.textContent = 'OPEN TABS';

        const t = document.getElementById('result');
        for (let index = 0; index < size; index += 1) {
          if (signal.aborted) {
            return;
          }
          try {
            const guid = await engine.search.guid(index);
            const obj = engine.body(guid);
            const percent = await engine.search.percent(index);

            const clone = document.importNode(t.content, true);
            clone.querySelector('a').href = obj.url;
            Object.assign(clone.querySelector('a').dataset, {
              tabId: obj.tabId,
              windowId: obj.windowId,
              frameId: obj.frameId,
              index,
              guid,
              percent
            });
            clone.querySelector('input[name=search]').checked = index == 0;
            clone.querySelector('cite').textContent = obj.url;
            clone.querySelector('h2').title = clone.querySelector('h2 span[data-id="title"]').textContent = obj.title;
            clone.querySelector('h2 img').src = obj.favIconUrl || cache[obj.tabId].favIconUrl || 'chrome://favicon/' + obj.url;
            clone.querySelector('h2 img').onerror = e => {
              e.target.src = 'web.svg';
            };

            const snippet = await engine.search.snippet({
              index,
              size: prefs['snippet-size']
            });
            // the HTML code that is returns from snippet is escaped
            // https://xapian.org/docs/apidoc/html/classXapian_1_1MSet.html#a6f834ac35fdcc58fcd5eb38fc7f320f1

            // clone.querySelector('p').content = clone.querySelector('p').innerHTML = snippet;

            // intersection observer
            new IntersectionObserver(arrange, {
              threshold: 1.0
            }).observe(clone.querySelector('h2'));

            root.appendChild(clone);
          }
          catch (e) {
            console.warn('Cannot add a result', e);
          }
        }
      }
      catch (e) {
        console.warn(e);
        info.textContent = e.message || 'Unknown error occurred';
      }
    });
  });
};
search.controllers = [];

document.getElementById('search').addEventListener('input', e => {
  const query = e.target.value.trim();
  root.textContent = '';
  const info = document.getElementById('info');
  if (query && ready) {
    search(query);
  }
  else {
    info.textContent = '';
    document.body.dataset.size = 0;
  }
  // Save last query
  chrome.storage.local.set({query});
});

const deep = async a => {
  const guid = a.dataset.guid;
  const data = engine.body(guid);
  await engine.new(1, 'one-tab');

  const prefs = await new Promise(resolve => chrome.storage.local.get({
    'snippet-size': 300,
    'search-size': 30
  }, resolve));

  const parts = data.body.split(/\n+/).filter(a => a);
  const bodies = [];
  let body = '';
  for (const part of parts) {
    body += '\n' + part;

    if (body.length > prefs['snippet-size']) {
      bodies.push(body);
      body = '';
    }
  }
  if (body) {
    bodies.push(body);
  }

  const lang = data.lang;
  try {
    for (const body of bodies) {
      await engine.add({
        body,
        lang
      }, undefined, undefined, 1);
    }
    const {size} = await engine.search({
      query: document.querySelector('#search input[type=search]').value,
      lang,
      length: prefs['search-size']
    }, 1);

    if (size) {
      const o = a.closest('.result');
      for (let index = size - 1; index >= 0; index -= 1) {
        const n = o.cloneNode(true);

        const snippet = await engine.search.snippet({
          index,
          size: prefs['snippet-size']
        });

        n.classList.add('sub');
        n.querySelector('img').remove();
        n.querySelector('[data-id=title]').textContent = '??? ' + n.querySelector('[data-id=title]').textContent;
        // n.querySelector('p').content = n.querySelector('p').innerHTML = snippet;

        const code = n.querySelector('h2 code');
        const percent = await engine.search.percent(index);
        code.textContent = percent + '%';

        // intersection observer
        new IntersectionObserver(arrange, {
          threshold: 1.0
        }).observe(n.querySelector('h2'));

        o.insertAdjacentElement('afterend', n);
      }
    }
  }
  catch (e) {
    console.warn(e);
  }
  engine.release(1);
};

document.addEventListener('click', e => {
  const a = e.target.closest('[data-cmd]');

  if (e.target.dataset.id === 'select') {
    return;
  }

  if (a) {
    const cmd = a.dataset.cmd;

    if (cmd === 'open') {
      const {tabId, windowId, frameId} = a.dataset;
      const snippet = e.target.closest('.result').querySelector('p').content;
      chrome.runtime.sendMessage({
        method: 'find',
        tabId: Number(tabId),
        windowId: Number(windowId),
        frameId,
        snippet
      }, () => window.close());
      e.preventDefault();
    }
  }
});

// keyboard shortcut
window.addEventListener('keydown', e => {
  const meta = e.metaKey || e.ctrlKey;

  if (meta && e.code && e.code.startsWith('Digit')) {
    e.preventDefault();
    const index = Number(e.code.replace('Digit', ''));
    const n = document.querySelector(`[data-count="${index}"]`);
    if (n) {
      n.click();
    }
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    const input = document.querySelector('#search input[type=search]');
    return input.focus();
  }
  if (meta && e.code === 'KeyR') {
    e.stopPropagation();
    e.preventDefault();

    location.reload();
  }
  else if (e.code === 'Space' && e.shiftKey) {
    e.preventDefault();
    const i = document.querySelector('.result input[type=radio]:checked');

    if (i) {
      i.closest('div').querySelector('[data-id=select]').click();
    }
  }
  else if (e.code === 'Escape' && e.target.value === '') {
    window.close();
  }
 
  // Extract all tabs into a new window
  else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && e.shiftKey) {
    e.preventDefault();

    const ids = [...document.querySelectorAll('[data-tab-id]')]
      .filter(a => meta ? Number(a.dataset.percent) >= 80 : true)
      .map(a => a.dataset.tabId)
      .filter((s, i, l) => l.indexOf(s) === i)
      .map(Number);

    if (ids.length) {
      chrome.runtime.sendMessage({
        method: 'group',
        ids
      }, () => window.close());
    }
  }
  else if ((e.code === 'Enter' || e.code === 'NumpadEnter')) {
    e.preventDefault();
    const n = document.querySelector(`.result input[type=radio]:checked + a`);
    n.click();
  }

  else if (e.code === 'ArrowUp') {
    e.preventDefault();

    const es = [...document.querySelectorAll('.result input[type=radio]')];
    const n = es.findIndex(e => e.checked);
    if (n === 1) {
      es[0].checked = true;
      root.scrollTo({top: 0, behavior: 'smooth'});
    }
    else if (n === 0) {
      es[es.length - 1].checked = true;
      const parent = es[es.length - 1].parentElement;
      parent.scrollIntoView({block: 'center', behavior: 'smooth'});
    }
    else if (n !== 0) {
      es[n - 1].checked = true;
      const parent = es[n - 1].parentElement;
      if (parent.getBoundingClientRect().top < root.getBoundingClientRect().top) {
        parent.scrollIntoView({block: 'center', behavior: 'smooth'});
      }
    }
  }

  else if (e.code === 'ArrowDown') {
    e.preventDefault();

    const es = [...document.querySelectorAll('.result input[type=radio]')];
    const n = es.findIndex(e => e.checked);
    if (n !== -1 && n !== es.length - 1) {
      es[n + 1].checked = true;
      const parent = es[n + 1].parentElement;
      if (
        parent.getBoundingClientRect().bottom > document.documentElement.clientHeight ||
        parent.getBoundingClientRect().top < root.getBoundingClientRect().top
      ) {
        parent.scrollIntoView({block: 'center', behavior: 'smooth'});
      }
    }
    else if (n === es.length - 1) {
      es[0].checked = true;
      root.scrollTo({top: 0, behavior: 'smooth'});
    }
  }

  else if (e.code === 'PageDown') {
    e.preventDefault();

    const es = [...document.querySelectorAll('.result input[type=radio]')];
    es[es.length - 1].checked = true;
    const parent = es[es.length - 1].parentElement;
    parent.scrollIntoView({block: 'center', behavior: 'smooth'});
  }

  else if (e.code === 'PageUp') {
    e.preventDefault();

    const es = [...document.querySelectorAll('.result input[type=radio]')];
    es[0].checked = true;
    root.scrollTo({top: 0, behavior: 'smooth'});
  }
});

// Select results
document.addEventListener('change', () => {
  document.body.dataset.menu = Boolean(document.querySelector('#results [data-id="select"]:checked'));
});

// Select xapian engine adding script
chrome.storage.local.get({
  engine: 'xapian'
}, prefs => {
  const s = document.createElement('script');
  s.src = '../' + prefs.engine + '/connect.js';
  console.info('I am using', prefs.engine, 'engine');
  document.body.dataset.engine = prefs.engine;
  document.body.appendChild(s);
});


