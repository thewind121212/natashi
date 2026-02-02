import { createServer, startServer } from './server';
import { WebSocketHandler } from './websocket';
import { createServer as createHttpServer } from 'http';

async function main(): Promise<void> {
  console.log('=== Audio Playground (Node.js) ===');

  // Create Express app and HTTP server
  const app = createServer();
  const httpServer = createHttpServer(app);

  // Create WebSocket handler
  const wsHandler = new WebSocketHandler(httpServer);

  // Start HTTP server
  await new Promise<void>((resolve) => {
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
  } catch (err) {
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
