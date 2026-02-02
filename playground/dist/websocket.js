"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketHandler = void 0;
const ws_1 = require("ws");
const socket_client_1 = require("./socket-client");
const audio_player_1 = require("./audio-player");
class WebSocketHandler {
    constructor(server) {
        this.clients = new Set();
        this.currentSessionId = null;
        this.bytesReceived = 0;
        this.debugMode = false; // When true, play audio to macOS speakers
        this.wss = new ws_1.WebSocketServer({ server });
        this.socketClient = new socket_client_1.SocketClient();
        this.audioPlayer = new audio_player_1.AudioPlayer();
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
            // Send current debug mode state
            ws.send(JSON.stringify({ type: 'debug_mode', enabled: this.debugMode }));
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
            this.broadcastJson({ type: 'player_stopped' });
        });
        this.audioPlayer.on('error', (err) => {
            this.log('nodejs', `Audio player error: ${err.message}`);
            this.broadcastJson({ type: 'error', message: 'Audio player error: ' + err.message });
        });
    }
    async connect() {
        try {
            await this.socketClient.connect();
            this.log('nodejs', 'Connected to Go server');
            this.socketClient.on('event', (event) => {
                this.log('go', `Event: ${event.type}`);
                this.handleGoEvent(event);
            });
            this.socketClient.on('audio', (data) => {
                this.bytesReceived += data.length;
                // Play audio if debug mode is enabled
                if (this.debugMode) {
                    this.audioPlayer.write(data);
                }
                // Update browser with progress every ~100KB
                // PCM 48kHz stereo 16-bit = 192000 bytes/sec
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
                this.log('go', 'Connection closed');
                this.audioPlayer.stop();
                this.broadcastJson({ type: 'error', session_id: '', message: 'Server disconnected' });
            });
        }
        catch (err) {
            this.log('nodejs', `Failed to connect to Go server: ${err}`);
            throw err;
        }
    }
    handleGoEvent(event) {
        switch (event.type) {
            case 'ready':
                this.log('go', 'Stream ready');
                if (this.debugMode) {
                    this.log('nodejs', 'Debug mode ON - playing to macOS speakers');
                    this.audioPlayer.start();
                }
                this.broadcastJson(event);
                break;
            case 'finished':
                this.log('go', `Stream finished, total: ${this.bytesReceived} bytes`);
                if (this.debugMode) {
                    this.audioPlayer.end();
                }
                this.broadcastJson(event);
                break;
            case 'error':
                this.log('go', `Error: ${event.message}`);
                this.audioPlayer.stop();
                this.broadcastJson(event);
                break;
            default:
                this.broadcastJson(event);
        }
    }
    handleBrowserMessage(ws, data) {
        try {
            const message = JSON.parse(data.toString());
            this.log('nodejs', `Browser action: ${message.action || message.type}`);
            if (message.action === 'play' && message.url) {
                this.bytesReceived = 0;
                this.audioPlayer.stop();
                const sessionId = generateSessionId();
                this.currentSessionId = sessionId;
                this.log('nodejs', `Starting playback: ${message.url}`);
                this.log('go', `Play command sent (session: ${sessionId.slice(0, 8)}...)`);
                // Use PCM format for debug playback
                const command = {
                    type: 'play',
                    session_id: sessionId,
                    url: message.url,
                    format: 'pcm',
                };
                this.socketClient.send(command);
                ws.send(JSON.stringify({ type: 'session', session_id: sessionId }));
            }
            else if (message.action === 'stop') {
                if (this.currentSessionId) {
                    this.log('go', 'Stop command sent');
                    const command = {
                        type: 'stop',
                        session_id: this.currentSessionId,
                    };
                    this.socketClient.send(command);
                }
                this.audioPlayer.stop();
                this.currentSessionId = null;
            }
            else if (message.action === 'set_debug') {
                this.debugMode = !!message.enabled;
                this.log('nodejs', `Debug mode: ${this.debugMode ? 'ON' : 'OFF'}`);
                this.broadcastJson({ type: 'debug_mode', enabled: this.debugMode });
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