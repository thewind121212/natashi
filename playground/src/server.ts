import express, { Express } from 'express';
import * as path from 'path';

const PORT = 3000;

export function createServer(): Express {
  const app = express();

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, '../public')));

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

export function startServer(app: Express): Promise<void> {
  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}`);
      resolve();
    });
  });
}
