export class VoiceControls {
    constructor({ browserWindow = globalThis.window, onTranscript = () => {}, onRecordingState = () => {} } = {}) {
        this.browserWindow = browserWindow;
        this.onTranscript = onTranscript;
        this.onRecordingState = onRecordingState;
        this.recognition = null;
        this.recording = false;
        this.transcript = '';
    }

    startRecording(existingText = '') {
        const Recognition = this.browserWindow?.SpeechRecognition || this.browserWindow?.webkitSpeechRecognition;
        if (!Recognition) {
            this.onRecordingState('unsupported', 'Speech recognition is not supported in this browser.');
            return false;
        }

        this.cancelRecording();
        this.transcript = existingText;
        const recognition = new Recognition();
        this.recognition = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = this.browserWindow.navigator?.language || 'en-US';
        let recognitionError = false;

        recognition.onstart = () => {
            this.recording = true;
            this.onRecordingState('recording', 'Listening…');
        };
        recognition.onresult = event => {
            let recognized = '';
            for (let index = 0; index < event.results.length; index += 1) {
                recognized += event.results[index][0].transcript;
            }
            this.onTranscript([this.transcript.trim(), recognized.trim()].filter(Boolean).join(' '));
        };
        recognition.onerror = event => {
            recognitionError = true;
            this.recording = false;
            if (event.error === 'no-speech') {
                this.onRecordingState('error', 'No speech detected. Please try again.');
            } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                this.onRecordingState('error', 'Microphone permission was denied. Allow microphone access and try again.');
            } else {
                this.onRecordingState('error', `Speech recognition failed: ${event.error}.`);
            }
        };
        recognition.onend = () => {
            this.recording = false;
            this.recognition = null;
            if (!recognitionError) this.onRecordingState('idle', '');
        };

        try {
            recognition.start();
            return true;
        } catch (error) {
            this.recording = false;
            this.recognition = null;
            this.onRecordingState('error', 'Could not start speech recognition. Check microphone access and try again.');
            return false;
        }
    }

    cancelRecording() {
        const wasRecording = Boolean(this.recognition);
        if (this.recognition) {
            this.recognition.onresult = null;
            this.recognition.onend = null;
            this.recognition.onerror = null;
            this.recognition.stop();
            this.recognition = null;
        }
        this.recording = false;
        if (wasRecording) this.onTranscript(this.transcript);
        this.transcript = '';
        this.onRecordingState('idle', '');
    }
}
