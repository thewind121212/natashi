"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketClient = void 0;
const net = __importStar(require("net"));
const events_1 = require("events");
const SOCKET_PATH = '/tmp/music-playground.sock';
// SocketClient handles Unix socket connection for receiving audio data.
// Control commands are now handled via HTTP API (see api-client.ts).
class SocketClient extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.socket = null;
        this.connected = false;
        this.buffer = Buffer.alloc(0);
        this.readingAudio = false;
        this.audioLength = 0;
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = net.createConnection(SOCKET_PATH, () => {
                console.log('[SocketClient] Connected to Go server (audio)');
                this.connected = true;
                resolve();
            });
            this.socket.on('error', (err) => {
                console.error('[SocketClient] Error:', err.message);
                this.connected = false;
                if (!this.connected) {
                    reject(err);
                }
                this.emit('error', err);
            });
            this.socket.on('close', () => {
                console.log('[SocketClient] Disconnected');
                this.connected = false;
                this.emit('close');
            });
            this.socket.on('data', (data) => this.handleData(data));
        });
    }
    handleData(data) {
        this.buffer = Buffer.concat([this.buffer, data]);
        this.processBuffer();
    }
    processBuffer() {
        while (this.buffer.length > 0) {
            if (this.readingAudio) {
                // Reading binary audio data
                if (this.buffer.length >= this.audioLength) {
                    const audioData = this.buffer.subarray(0, this.audioLength);
                    this.buffer = this.buffer.subarray(this.audioLength);
                    this.readingAudio = false;
                    this.emit('audio', audioData);
                }
                else {
                    break; // Need more data
                }
            }
            else {
                // Skip any newlines (json.Encoder adds \n after each JSON object)
                while (this.buffer.length > 0 && this.buffer[0] === 0x0a) {
                    this.buffer = this.buffer.subarray(1);
                }
                if (this.buffer.length === 0)
                    break;
                // Check if this is JSON (event) or binary header (audio)
                // Audio header: 4 bytes length (big-endian)
                // JSON starts with '{'
                if (this.buffer[0] === 0x7b) { // '{' character
                    // Try to parse JSON
                    const newlineIdx = this.buffer.indexOf('\n');
                    const endIdx = newlineIdx >= 0 ? newlineIdx : this.buffer.indexOf('}') + 1;
                    if (endIdx > 0) {
                        try {
                            // Find complete JSON object
                            let jsonEnd = 0;
                            let depth = 0;
                            for (let i = 0; i < this.buffer.length; i++) {
                                if (this.buffer[i] === 0x7b)
                                    depth++;
                                if (this.buffer[i] === 0x7d)
                                    depth--;
                                if (depth === 0) {
                                    jsonEnd = i + 1;
                                    break;
                                }
                            }
                            if (jsonEnd > 0) {
                                const jsonStr = this.buffer.subarray(0, jsonEnd).toString('utf8');
                                this.buffer = this.buffer.subarray(jsonEnd);
                                const event = JSON.parse(jsonStr);
                                this.emit('event', event);
                            }
                            else {
                                break; // Need more data
                            }
                        }
                        catch {
                            // Not valid JSON yet, wait for more data
                            break;
                        }
                    }
                    else {
                        break; // Need more data
                    }
                }
                else if (this.buffer.length >= 4) {
                    // Binary audio header (4 bytes big-endian length)
                    this.audioLength = (this.buffer[0] << 24) | (this.buffer[1] << 16) |
                        (this.buffer[2] << 8) | this.buffer[3];
                    this.buffer = this.buffer.subarray(4);
                    this.readingAudio = true;
                }
                else {
                    break; // Need more data
                }
            }
        }
    }
    disconnect() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
    }
    isConnected() {
        return this.connected;
    }
}
exports.SocketClient = SocketClient;
//# sourceMappingURL=socket-client.js.map