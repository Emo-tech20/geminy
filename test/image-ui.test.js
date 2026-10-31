import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');

test('image prompt dialogs call window.prompt without shadowing it', () => {
  assert.match(appSource, /const imagePrompt = window\.prompt\(/);
  assert.match(appSource, /regenerateImage\(imagePrompt\)/);
  assert.match(appSource, /const newPrompt = window\.prompt\([^;]+imagePrompt\)/);
  assert.doesNotMatch(appSource, /const prompt = prompt\(/);
});

test('image-generation API failures remain visible in the conversation', () => {
  const start = appSource.indexOf('async generateImage(prompt)');
  const end = appSource.indexOf('async downloadImage(', start);
  const generateMethod = appSource.slice(start, end);

  assert.ok(generateMethod.indexOf('await response.json()') < generateMethod.indexOf('loadingEl.remove()'));
  assert.match(generateMethod, /if \(!response\.ok \|\| !data\.imageUrl\)/);
  assert.match(generateMethod, /loadingEl\.classList\.remove\('loading'\)/);
  assert.match(generateMethod, /if \(loadingEl\.isConnected\)/);
});

test('image downloads use the authenticated same-origin endpoint for private Storage', () => {
  const start = appSource.indexOf('async downloadImage(');
  const end = appSource.indexOf('async loadImageHistory(', start);
  const downloadMethod = appSource.slice(start, end);

  assert.match(downloadMethod, /\/images\/\$\{encodeURIComponent\(imageId\)\}\/download/);
  assert.match(downloadMethod, /this\.authenticatedFetch\(/);
  assert.match(downloadMethod, /URL\.createObjectURL\(blob\)/);
  assert.match(downloadMethod, /URL\.revokeObjectURL\(downloadUrl\)/);
});
