import express, { Express, Request, Response } from 'express';
import * as path from 'path';
import * as crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { ApiClient } from './api-client';
import { discordOAuth } from './auth/discord-oauth';
import { signToken, verifyToken } from './auth/jwt';

const PORT = 3000;

export function createServer(): Express {
  const app = express();
  const apiClient = new ApiClient();

  // Parse JSON body and cookies
  app.use(express.json());
  app.use(cookieParser());

  // Serve static files from public directory
  app.use(express.static(path.join(__dirname, '../public')));

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // === OAuth Routes ===

  // Initiate Discord OAuth2 flow
  app.get('/auth/discord', (_req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { httpOnly: true, maxAge: 600000 }); // 10 min
    res.redirect(discordOAuth.getAuthorizationUrl(state));
  });

  // OAuth2 callback
  app.get('/auth/callback', async (req: Request, res: Response) => {
    const { code, state } = req.query;
    const savedState = req.cookies.oauth_state;

    // Validate state to prevent CSRF
    if (!state || state !== savedState) {
      res.status(400).send('Invalid state parameter');
      return;
    }

    if (!code || typeof code !== 'string') {
      res.status(400).send('Missing authorization code');
      return;
    }

    try {
      const tokens = await discordOAuth.exchangeCode(code);
      const user = await discordOAuth.getUser(tokens.access_token);

      const jwt = signToken({
        sub: user.id,
        username: user.global_name || user.username,
        avatar: discordOAuth.getAvatarUrl(user),
      });

      res.cookie('auth', jwt, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
      res.clearCookie('oauth_state');
      res.redirect('/');
    } catch (err) {
      console.error('[Auth] OAuth callback error:', err);
      res.status(500).send('Authentication failed');
    }
  });

  // Get current user
  app.get('/auth/me', (req: Request, res: Response) => {
    const token = req.cookies.auth;
    if (!token) {
      res.json({ user: null });
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      res.json({ user: null });
      return;
    }

    res.json({
      user: {
        id: payload.sub,
        username: payload.username,
        avatar: payload.avatar,
      },
    });
  });

  // Logout
  app.post('/auth/logout', (_req, res) => {
    res.clearCookie('auth');
    res.json({ success: true });
  });

  // === Session Control Endpoints (proxy to Go API) ===

  // Play - start a session
  app.post('/api/session/:id/play', async (req: Request, res: Response) => {
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
    } catch (err) {
      console.error('[API] Play error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Stop - stop a session
  app.post('/api/session/:id/stop', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      console.log(`[API] Stop: session=${id}`);
      const result = await apiClient.stop(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Stop error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Pause - pause a session
  app.post('/api/session/:id/pause', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      console.log(`[API] Pause: session=${id}`);
      const result = await apiClient.pause(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Pause error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Resume - resume a session
  app.post('/api/session/:id/resume', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      console.log(`[API] Resume: session=${id}`);
      const result = await apiClient.resume(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Resume error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Status - get session status
  app.get('/api/session/:id/status', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const result = await apiClient.status(id);
      res.json(result);
    } catch (err) {
      console.error('[API] Status error:', err);
      res.status(500).json({ status: 'error', message: String(err) });
    }
  });

  // Go API health check
  app.get('/api/go/health', async (_req: Request, res: Response) => {
    try {
      const result = await apiClient.health();
      res.json(result);
    } catch (err) {
      res.status(503).json({ status: 'error', message: 'Go API unavailable' });
    }
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
