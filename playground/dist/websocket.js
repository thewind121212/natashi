"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketHandler = void 0;
const ws_1 = require("ws");
const socket_client_1 = require("./socket-client");
const api_client_1 = require("./api-client");
const audio_player_1 = require("./audio-player");
class WebSocketHandler {
    constructor(server) {
        this.clients = new Set();
        this.currentSessionId = null;
        this.bytesReceived = 0;
        this.isPaused = false;
        this.isStreamReady = false;
        this.wss = new ws_1.WebSocketServer({ server });
        this.socketClient = new socket_client_1.SocketClient();
        this.apiClient = new api_client_1.ApiClient();
        this.audioPlayer = new audio_player_1.AudioPlayer();
        this.debugMode = process.env.DEBUG_AUDIO === '1';
        if (this.debugMode) {
            console.log('[WebSocket] Debug mode enabled via DEBUG_AUDIO=1');
        }
        this.setupWebSocket();
        this.setupAudioPlayer();
    }
    log(source, message) {
        console.log(`[${source === 'go' ? 'Go' : 'Node'}] ${message}`);
        this.broadcastJson({ type: 'log', source, message });
    }
    setupWebSocket() {
        this.wss.on('connection', (ws) => {
            this.log('nodejs', 'Browser connected');
            this.clients.add(ws);
            ws.send(JSON.stringify({
                type: 'state',
                debugMode: this.debugMode,
                isPaused: this.isPaused,
                isPlaying: this.currentSessionId !== null,
            }));
            ws.on('message', (data) => this.handleBrowserMessage(ws, data));
            ws.on('close', () => {
                this.log('nodejs', 'Browser disconnected');
                this.clients.delete(ws);
            });
            ws.on('error', (err) => {
                this.log('nodejs', `WebSocket error: ${err.message}`);
            });
        });
    }
    setupAudioPlayer() {
        this.audioPlayer.on('stopped', () => {
            // Don't broadcast - we handle state manually
        });
        this.audioPlayer.on('error', (err) => {
            this.log('nodejs', `Audio player error: ${err.message}`);
        });
    }
    async connect() {
        // First check if Go API is healthy
        try {
            const health = await this.apiClient.health();
            this.log('nodejs', `Go API health: ${health.status}`);
        }
        catch (err) {
            throw new Error('Go API not available. Start Go server first.');
        }
        // Then connect socket for audio
        try {
            await this.socketClient.connect();
            this.log('nodejs', 'Connected to Go socket (audio)');
            this.socketClient.on('event', (event) => {
                this.handleGoEvent(event);
            });
            this.socketClient.on('audio', (data) => {
                // Skip if paused or no active session
                if (this.isPaused || !this.currentSessionId) {
                    return;
                }
                this.bytesReceived += data.length;
                // Log first audio chunk
                if (this.bytesReceived === data.length) {
                    this.log('nodejs', `First audio chunk: ${data.length} bytes, streamReady=${this.isStreamReady}`);
                }
                // Play audio if debug mode is enabled and stream is ready
                if (this.debugMode && this.isStreamReady) {
                    this.audioPlayer.write(data);
                }
                // Update browser with progress every ~100KB
                if (this.bytesReceived % 100000 < data.length) {
                    const playbackSecs = this.bytesReceived / 192000;
                    this.broadcastJson({
                        type: 'progress',
                        bytes: this.bytesReceived,
                        playback_secs: playbackSecs,
                    });
                }
            });
            this.socketClient.on('close', () => {
                this.log('go', 'Socket connection closed');
                this.resetPlaybackState();
                this.broadcastJson({ type: 'error', session_id: '', message: 'Server disconnected' });
            });
        }
        catch (err) {
            this.log('nodejs', `Failed to connect to Go socket: ${err}`);
            throw err;
        }
    }
    resetPlaybackState() {
        this.audioPlayer.stop();
        this.currentSessionId = null;
        this.isPaused = false;
        this.isStreamReady = false;
        this.bytesReceived = 0;
    }
    handleGoEvent(event) {
        // IMPORTANT: Ignore events from old sessions
        const eventSessionShort = event.session_id ? event.session_id.slice(0, 8) : 'none';
        const currentSessionShort = this.currentSessionId ? this.currentSessionId.slice(0, 8) : 'none';
        this.log('go', `Event: ${event.type} (event=${eventSessionShort}, current=${currentSessionShort})`);
        if (event.session_id && this.currentSessionId && event.session_id !== this.currentSessionId) {
            this.log('go', `Ignoring - session mismatch`);
            return;
        }
        switch (event.type) {
            case 'ready':
                this.isStreamReady = true;
                this.log('nodejs', `Ready received: debugMode=${this.debugMode}, isPaused=${this.isPaused}`);
                if (this.debugMode && !this.isPaused) {
                    this.log('nodejs', 'Starting audio player');
                    this.audioPlayer.start();
                }
                this.broadcastJson(event);
                break;
            case 'finished':
                this.log('go', `Stream finished, total: ${this.bytesReceived} bytes`);
                if (this.debugMode) {
                    this.audioPlayer.end();
                }
                this.currentSessionId = null;
                this.isStreamReady = false;
                this.broadcastJson({ ...event, bytes: this.bytesReceived });
                break;
            case 'error':
                this.log('go', `Error: ${event.message}`);
                this.resetPlaybackState();
                this.broadcastJson(event);
                break;
            default:
                this.broadcastJson(event);
        }
    }
    async handleBrowserMessage(ws, data) {
        try {
            const message = JSON.parse(data.toString());
            this.log('nodejs', `Browser action: ${message.action || message.type}`);
            if (message.action === 'play' && message.url) {
                // Stop current session if any
                if (this.currentSessionId) {
                    this.log('nodejs', 'Stopping current session for new play');
                    try {
                        await this.apiClient.stop(this.currentSessionId);
                    }
                    catch (err) {
                        this.log('nodejs', `Stop error (ignored): ${err}`);
                    }
                    this.audioPlayer.stop();
                }
                // Reset state for new session
                this.bytesReceived = 0;
                this.isPaused = false;
                this.isStreamReady = false;
                // Generate new session ID
                const sessionId = generateSessionId();
                this.currentSessionId = sessionId;
                this.log('nodejs', `New session: ${sessionId.slice(0, 8)}...`);
                this.log('nodejs', `Starting playback: ${message.url}`);
                // Call API to start playback
                try {
                    const result = await this.apiClient.play(sessionId, message.url, 'pcm');
                    this.log('go', `Play response: ${result.status}`);
                    ws.send(JSON.stringify({ type: 'session', session_id: sessionId }));
                }
                catch (err) {
                    this.log('nodejs', `Play error: ${err}`);
                    this.currentSessionId = null;
                    this.broadcastJson({ type: 'error', session_id: sessionId, message: `${err}` });
                }
            }
            else if (message.action === 'stop') {
                if (this.currentSessionId) {
                    this.log('go', 'Stop command sent');
                    try {
                        await this.apiClient.stop(this.currentSessionId);
                    }
                    catch (err) {
                        this.log('nodejs', `Stop error: ${err}`);
                    }
                }
                this.resetPlaybackState();
                this.broadcastJson({ type: 'stopped' });
            }
            else if (message.action === 'pause') {
                if (this.currentSessionId && !this.isPaused) {
                    this.isPaused = true;
                    if (this.debugMode) {
                        this.audioPlayer.stop();
                    }
                    try {
                        await this.apiClient.pause(this.currentSessionId);
                        this.log('nodejs', 'Playback paused');
                        this.broadcastJson({ type: 'paused' });
                    }
                    catch (err) {
                        this.log('nodejs', `Pause error: ${err}`);
                    }
                }
            }
            else if (message.action === 'resume') {
                if (this.currentSessionId && this.isPaused) {
                    this.isPaused = false;
                    if (this.debugMode && this.isStreamReady) {
                        this.log('nodejs', 'Restarting audio player');
                        this.audioPlayer.start();
                    }
                    try {
                        await this.apiClient.resume(this.currentSessionId);
                        this.log('nodejs', 'Playback resumed');
                        this.broadcastJson({ type: 'resumed' });
                    }
                    catch (err) {
                        this.log('nodejs', `Resume error: ${err}`);
                    }
                }
            }
        }
        catch (err) {
            this.log('nodejs', `Error handling message: ${err}`);
        }
    }
    broadcastJson(data) {
        const json = JSON.stringify(data);
        for (const client of this.clients) {
            if (client.readyState === 1) {
                client.send(json);
            }
        }
    }
    isConnected() {
        return this.socketClient.isConnected();
    }
}
exports.WebSocketHandler = WebSocketHandler;
function generateSessionId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
//# sourceMappingURL=websocket.js.map