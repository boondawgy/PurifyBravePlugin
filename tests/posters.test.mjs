import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Small DOM fixture for the content script; models Plex's observed sibling
// artwork/link layout and browser selectors used here without network packages.
class Element {
  constructor(tag = 'div', attrs = {}, children = []) {
    this.tag = tag; this.attrs = attrs; this.children = []; this.dataset = {};
    this.events = {}; this.textContent = ''; this.disabled = false;
    this.classList = {
      contains: name => (this.className || '').split(' ').includes(name),
      add: name => { if (!this.classList.contains(name)) this.className = `${this.className || ''} ${name}`.trim(); },
      toggle: (name, on) => {
        if (on) this.classList.add(name);
        else this.className = (this.className || '').split(' ').filter(item => item !== name).join(' ');
      }
    };
    children.forEach(child => this.append(child));
  }
  get className() { return this.attrs.class || ''; }
  set className(value) { this.attrs.class = value; }
  get href() { return this.attrs.href; }
  matches(selector) {
    return selector.split(',').some(part => {
      const value = part.trim();
      if (value.startsWith('.')) return this.classList.contains(value.slice(1));
      const attr = value.match(/^(\w+)?\[([\w-]+)(\*=|=)?(?:"([^"]*)")?\]$/);
      if (attr) return (!attr[1] || this.tag === attr[1]) && this.attrs[attr[2]] !== undefined &&
        (!attr[3] || (attr[3] === '*=' ? this.attrs[attr[2]].includes(attr[4]) : this.attrs[attr[2]] === attr[4]));
      return this.tag === value;
    });
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  append(child) { child.parentElement = this; this.children.push(child); }
  remove() { this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  getClientRects() { return [{}]; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
}
const href = key => `https://app.plex.tv/desktop/#!/server/nas/details?key=%2Flibrary%2Fmetadata%2F${key}`;
function card(key) {
  return new Element('div', {class:'MetadataSimplePosterCard-card-baQSyw PosterCard-card-BRB1k_'}, [
    new Element('div', {class:'MetadataSimplePosterCard-image-x27yrl'}, [new Element('img')]),
    new Element('a', {class:'PosterCardLink-link-LozvMm', href:href(key)})
  ]);
}
async function load(cards, eligible = true, serverStatus = 'unknown') {
  const body = new Element('body', {}, cards);
  const calls = [];
  let observer;
  const document = {
    body, querySelectorAll: value => body.querySelectorAll(value),
    createElement: tag => new Element(tag), getElementById: () => null,
    addEventListener() {}
  };
  vm.runInNewContext(readFileSync(new URL('../content.js', import.meta.url), 'utf8'), {
    document, Element, URL, URLSearchParams,
    location: {href:'https://app.plex.tv/desktop/#!/media/nas/library?source=2'},
    window: {addEventListener() {}}, PurifyMenuPolicy: {isMovieActionMenu: () => false},
    MutationObserver: class {constructor(fn) { observer = fn; } observe() {}},
    requestAnimationFrame: callback => callback(), setTimeout() {}, clearTimeout() {},
    chrome: {runtime: {
      onMessage: {addListener() {}},
      async sendMessage(message) {
        calls.push(message);
        if (message.type === 'purify-refresh-policy') return {enabled:false};
        return {ok:true, eligible, status:message.type === 'purify' ? 'sent' : serverStatus, sent:message.type === 'purify' || ['sent', 'queued', 'processing', 'completed'].includes(serverStatus), error:serverStatus === 'failed' ? 'Processing was canceled.' : null};
      }
    }}
  });
  const settle = async () => { for (let i=0; i<20; i++) await Promise.resolve(); };
  await settle();
  return {body, calls, update: async () => {observer(); await settle();}};
}
test('adds one button to sibling-artwork card, above link; clicking submits without navigating', async () => {
  const poster = card('123');
  const app = await load([poster]);
  const button = poster.querySelector('.purify-poster-button');
  assert.ok(button);
  assert.equal(button.parentElement, poster);
  assert.equal(button.closest('a[href]'), null);
  assert.equal(button.textContent, 'P');
  let prevented = false, stopped = false;
  button.events.click({preventDefault() {prevented=true;}, stopPropagation() {stopped=true;}});
  await app.update();
  assert.ok(prevented && stopped);
  assert.equal(button.textContent, '↥');
  assert.equal(app.calls.filter(call => call.type === 'purify').length, 1);
  assert.equal(poster.querySelectorAll('.purify-poster-button').length, 1);
});
test('recycled card removes old identity and attaches the new movie action', async () => {
  const poster = card('123');
  const app = await load([poster]);
  const original = poster.querySelector('.purify-poster-button');
  poster.querySelector('a[href]').attrs.href = href('456');
  await app.update();
  const replacement = poster.querySelector('.purify-poster-button');
  assert.notEqual(replacement, original);
  assert.equal(replacement.dataset.purifyKey, 'nas:456');
});
test('does not decorate TV or cards with conflicting movie identities', async () => {
  const tv = card('123');
  await load([tv], false);
  assert.equal(tv.querySelector('.purify-poster-button'), null);
  const mixed = card('123');
  mixed.append(new Element('a', {href:href('456')}));
  await load([mixed]);
  assert.equal(mixed.querySelector('.purify-poster-button'), null);
});

test('server states have distinct accessible labels, colors, and retry behavior', async () => {
  for (const [status, symbol, color, disabled] of [
    ['sent', '↥', 'purify-queued', true], ['queued', '↥', 'purify-queued', true],
    ['processing', '◌', 'purify-processing', true], ['completed', '✓', 'purify-sent', true],
    ['failed', '!', 'purify-failed', false]
  ]) {
    const poster = card('123');
    await load([poster], true, status);
    const button = poster.querySelector('.purify-poster-button');
    assert.equal(button.textContent, symbol);
    assert.equal(button.classList.contains(color), true);
    assert.equal(button.disabled, disabled);
    assert.ok(button.attrs['aria-label'].includes(status === 'sent' ? 'Sent' : status === 'queued' ? 'Queued' : status === 'processing' ? 'Processing' : status));
    if (status === 'failed') assert.match(button.title, /canceled/);
  }
});
