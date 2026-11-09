import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const policySandbox = {};
vm.runInNewContext(readFileSync(new URL('../menu-policy.js', import.meta.url), 'utf8'), policySandbox);
const {isMovieActionMenu} = policySandbox.PurifyMenuPolicy;

test('accepts the poster action menu shown in the screenshot', () => {
  assert.equal(isMovieActionMenu(['Remove from Watchlist','Watch Together...','Play Next','Add to','Refresh Metadata','Analyze','Get Info']),true);
});
test('accepts the detail page action menu shown in the screenshot', () => {
  assert.equal(isMovieActionMenu(['Watch Together...','Share...','Refresh Metadata','Analyze','Fix Match...','Get Info']),true);
});
test('rejects filters, library menus, subtitle selectors, and Add to submenus', () => {
  for (const labels of [['All','Unplayed','Duplicates'],['Title','Year','Date Added'],['Refresh All Metadata','Analyze','Manage Library'],['None','English (SRT OpenSubtitles)'],['Add to Collection','Add to Playlist'],['Get Info']]) {
    assert.equal(isMovieActionMenu(labels),false);
  }
});
test('ignores menu label whitespace but requires exact native action labels', () => {
  assert.equal(isMovieActionMenu([' Get Info\n','Refresh  Metadata','Analyze ']),true);
  assert.equal(isMovieActionMenu(['Get Info for library','Refresh Metadata','Analyze']),false);
});
