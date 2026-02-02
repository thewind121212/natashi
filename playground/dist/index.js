"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const websocket_1 = require("./websocket");
const http_1 = require("http");
async function main() {
    console.log('=== Audio Playground (Node.js) ===');
    // Create Express app and HTTP server
    const app = (0, server_1.createServer)();
    const httpServer = (0, http_1.createServer)(app);
    // Create WebSocket handler
    const wsHandler = new websocket_1.WebSocketHandler(httpServer);
    // Start HTTP server
    await new Promise((resolve) => {
        httpServer.listen(3000, () => {
            console.log('[Server] Listening on http://localhost:3000');
            resolve();
        });
    });
    // Connect to Go server
    console.log('[Server] Connecting to Go server...');
    try {
        await wsHandler.connect();
        console.log('[Server] Connected to Go server');
    }
    catch (err) {
        console.error('[Server] Failed to connect to Go server. Make sure it is running.');
        console.error('[Server] Start Go server with: go run cmd/playground/main.go');
        process.exit(1);
    }
    console.log('[Server] Ready! Open http://localhost:3000 in your browser');
    // Handle shutdown
    process.on('SIGINT', () => {
        console.log('\n[Server] Shutting down...');
        httpServer.close();
        process.exit(0);
    });
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map