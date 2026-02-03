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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
exports.startServer = startServer;
const express_1 = __importDefault(require("express"));
const path = __importStar(require("path"));
const api_client_1 = require("./api-client");
const PORT = 3000;
function createServer() {
    const app = (0, express_1.default)();
    const apiClient = new api_client_1.ApiClient();
    // Parse JSON body
    app.use(express_1.default.json());
    // Serve static files from public directory
    app.use(express_1.default.static(path.join(__dirname, '../public')));
    // Health check endpoint
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });
    // === Session Control Endpoints (proxy to Go API) ===
    // Play - start a session
    app.post('/api/session/:id/play', async (req, res) => {
        try {
            const { id } = req.params;
            const { url, format } = req.body;
            if (!url) {
                res.status(400).json({ status: 'error', message: 'url is required' });
                return;
            }
            console.log(`[API] Play: session=${id} url=${url}`);
            const result = await apiClient.play(id, url, format || 'pcm');
            res.json(result);
        }
        catch (err) {
            console.error('[API] Play error:', err);
            res.status(500).json({ status: 'error', message: String(err) });
        }
    });
    // Stop - stop a session
    app.post('/api/session/:id/stop', async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`[API] Stop: session=${id}`);
            const result = await apiClient.stop(id);
            res.json(result);
        }
        catch (err) {
            console.error('[API] Stop error:', err);
            res.status(500).json({ status: 'error', message: String(err) });
        }
    });
    // Pause - pause a session
    app.post('/api/session/:id/pause', async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`[API] Pause: session=${id}`);
            const result = await apiClient.pause(id);
            res.json(result);
        }
        catch (err) {
            console.error('[API] Pause error:', err);
            res.status(500).json({ status: 'error', message: String(err) });
        }
    });
    // Resume - resume a session
    app.post('/api/session/:id/resume', async (req, res) => {
        try {
            const { id } = req.params;
            console.log(`[API] Resume: session=${id}`);
            const result = await apiClient.resume(id);
            res.json(result);
        }
        catch (err) {
            console.error('[API] Resume error:', err);
            res.status(500).json({ status: 'error', message: String(err) });
        }
    });
    // Status - get session status
    app.get('/api/session/:id/status', async (req, res) => {
        try {
            const { id } = req.params;
            const result = await apiClient.status(id);
            res.json(result);
        }
        catch (err) {
            console.error('[API] Status error:', err);
            res.status(500).json({ status: 'error', message: String(err) });
        }
    });
    // Go API health check
    app.get('/api/go/health', async (_req, res) => {
        try {
            const result = await apiClient.health();
            res.json(result);
        }
        catch (err) {
            res.status(503).json({ status: 'error', message: 'Go API unavailable' });
        }
    });
    return app;
}
function startServer(app) {
    return new Promise((resolve) => {
        app.listen(PORT, () => {
            console.log(`[Server] Listening on http://localhost:${PORT}`);
            resolve();
        });
    });
}
//# sourceMappingURL=server.js.map