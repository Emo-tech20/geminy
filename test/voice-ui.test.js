import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { VoiceControls } from '../public/js/voice.js';

class MockRecognition {
  start() {
    this.onstart?.();
  }
  stop() {
    this.onend?.();
  }
}

function createBrowser({ recognition = true } = {}) {
  return {
    navigator: { language: 'en-US' },
    ...(recognition ? { SpeechRecognition: MockRecognition } : {})
  };
}

test('model toolbar follows the main chat toolbar directly before the conversation', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');
  const toolbar = html.indexOf('<header class="chat-heading-bar chat-toolbar">');
  const selector = html.indexOf('<div class="chat-model-toolbar">');
  const messages = html.indexOf('<div class="messages-container">', selector);
  const composer = html.indexOf('<div class="chat-composer">', messages);
  assert.ok(toolbar >= 0 && toolbar < selector);
  const toolbarEnd = html.indexOf('</header>', toolbar) + '</header>'.length;
  assert.equal(html.slice(toolbarEnd, selector).trim(), '');
  assert.ok(selector < messages && messages < composer);
  assert.match(styles, /\.chat-main\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto/s);
  assert.match(html, /id="model-selector"/);
});

test('frontend contains no inline HTML event-handler attributes', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<[^>]*\s(?:on[a-z]+)\s*=/i);
  assert.doesNotMatch(app, /<[^>]*\s(?:on[a-z]+)\s*=/i);
});

test('model choice persists while obsolete voice-output preferences are removed', () => {
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(app, /localStorage\.setItem\('selectedModel', this\.selectedModel\)/);
  assert.match(app, /localStorage\.removeItem\('voiceAutoRead'\)/);
  assert.match(app, /localStorage\.removeItem\('voiceURI'\)/);
});

test('message presentation hides identity labels and retains copy actions without voice output controls', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
  const voice = readFileSync(new URL('../public/js/voice.js', import.meta.url), 'utf8');
  assert.match(styles, /\.message-avatar\s*\{\s*display:\s*none;/);
  assert.match(app, /data-action="copy-message"/);
  assert.doesNotMatch(html, /voice-auto-toggle|voice-selector|voice-settings|data-voice-action="(?:speak|pause-speech|stop-speech)"/);
  const appWithoutLegacyPreferenceCleanup = app.replace(/localStorage\.removeItem\('(voiceAutoRead|voiceURI)'\);/g, '');
  assert.doesNotMatch(appWithoutLegacyPreferenceCleanup, /voiceAutoRead|voiceURI|speechSynthesis|\.speak\(|pause-speech|stop-speech/);
  assert.doesNotMatch(voice, /speechSynthesis|SpeechSynthesis|\.speak\(|pauseOrResume|stopSpeaking/);
  assert.doesNotMatch(styles, /voice-response-actions|voice-auto-label|voice-selector|voice-settings/);
  assert.match(html, /class="voice-status" role="status"/);
});

test('mobile styles keep the model selector and composer controls within the layout', () => {
  const styles = readFileSync(new URL('../public/css/styles.css', import.meta.url), 'utf8');
  const mobileRules = styles.slice(styles.indexOf('@media (max-width: 768px)'));
  assert.match(mobileRules, /\.chat-model-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(styles, /\.composer-input\s*\{[^}]*min-width:\s*0/s);
  assert.match(mobileRules, /\.composer-button\s*\{/);
});

test('speech recognition converts recognized text and allows it to remain editable', () => {
  const browserWindow = createBrowser();
  const transcripts = [];
  const states = [];
  const voice = new VoiceControls({
    browserWindow,
    onTranscript: value => transcripts.push(value),
    onRecordingState: (state, message) => states.push({ state, message })
  });

  assert.equal(voice.startRecording('Existing question'), true);
  const recognition = voice.recognition;
  recognition.onresult({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: ' add another detail' } }]
  });
  assert.equal(transcripts.at(-1), 'Existing question add another detail');
  assert.ok(states.some(state => state.state === 'recording'));
  recognition.onend();
  assert.equal(voice.recognition, null);
});

test('canceling speech recognition discards its transcript and restores prior input', () => {
  const transcripts = [];
  const voice = new VoiceControls({
    browserWindow: createBrowser(),
    onTranscript: value => transcripts.push(value)
  });

  voice.startRecording('Keep this');
  voice.recognition.onresult({
    resultIndex: 0,
    results: [{ isFinal: true, 0: { transcript: 'discard this' } }]
  });
  voice.cancelRecording();
  assert.equal(transcripts.at(-1), 'Keep this');
  assert.equal(voice.recognition, null);
});

test('microphone permission denial remains visible after recognition ends', () => {
  const states = [];
  const voice = new VoiceControls({
    browserWindow: createBrowser(),
    onRecordingState: (state, message) => states.push({ state, message })
  });

  voice.startRecording();
  voice.recognition.onerror({ error: 'not-allowed' });
  voice.recognition.onend();
  assert.equal(states.at(-1).state, 'error');
  assert.match(states.at(-1).message, /permission was denied/i);
});

test('no-speech errors show retry guidance and reset recording state', () => {
  const states = [];
  const voice = new VoiceControls({
    browserWindow: createBrowser(),
    onRecordingState: (state, message) => states.push({ state, message })
  });

  voice.startRecording();
  const recognition = voice.recognition;
  recognition.onerror({ error: 'no-speech' });
  recognition.onend();
  assert.equal(voice.recording, false);
  assert.equal(voice.recognition, null);
  assert.equal(states.at(-1).state, 'error');
  assert.equal(states.at(-1).message, 'No speech detected. Please try again.');
  assert.equal(voice.startRecording(), true);
});

test('unsupported speech recognition does not pretend to record', () => {
  const states = [];
  const voice = new VoiceControls({
    browserWindow: createBrowser({ recognition: false }),
    onRecordingState: (state, message) => states.push({ state, message })
  });
  assert.equal(voice.startRecording(), false);
  assert.equal(states[0].state, 'unsupported');
  assert.match(states[0].message, /not supported/i);
});
