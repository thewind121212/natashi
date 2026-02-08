// Bot Controller WebSocket - pushes guild list + state to subscribed clients
// Replaces REST polling from useGuildList (4s) and useBotApi (2s)
// Simple interval-based push, no event emitters required

import { IncomingMessage } from 'http';
import { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import { parse as parseCookie } from 'cookie';
import { Client } from 'discord.js';
import { verifyToken } from '../auth/jwt';
import { config } from '../config';
import { getActiveGuilds, getGuildState, type ActiveGuild, type GuildStateResponse } from './bot-actions';

const PUSH_INTERVAL_MS = 1000; // Push state every 1s (was 2s REST poll + 4s guild poll)

interface BotClient {
  ws: WebSocket;
  subscribedGuilds: Set<string>;
}

export class BotWebSocketHandler {
  private wss: WebSocketServer;
  private clients: Set<BotClient> = new Set();
  private getClient: () => Client | null;
  private pushTimer: NodeJS.Timeout | null = null;

  // Cache last sent data to avoid sending duplicates
  private lastGuildListJson = '';
  private lastGuildStateJson: Map<string, string> = new Map();

  constructor(getClient: () => Client | null) {
    this.getClient = getClient;
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    // Authenticate before upgrading
    const user = this.authenticate(request);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  private authenticate(req: IncomingMessage): { sub: string } | null {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;

    const cookies = parseCookie(cookieHeader);
    const token = cookies.auth;
    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload) return null;

    if (config.allowedDiscordIds.length > 0 && !config.allowedDiscordIds.includes(payload.sub)) {
      return null;
    }

    return payload;
  }

  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    const botClient: BotClient = { ws, subscribedGuilds: new Set() };
    this.clients.add(botClient);

    // Send initial guild list immediately
    const client = this.getClient();
    if (client) {
      const guilds = getActiveGuilds(client);
      const json = JSON.stringify({ type: 'guildList', guilds });
      ws.send(json);
    } else {
      ws.send(JSON.stringify({ type: 'guildList', guilds: [] }));
    }

    // Start push timer if this is the first client
    if (this.clients.size === 1) {
      this.startPushLoop();
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === 'subscribe' && typeof msg.guildId === 'string') {
          botClient.subscribedGuilds.add(msg.guildId);
          // Send immediate state snapshot
          this.pushGuildStateTo(botClient, msg.guildId);
        } else if (msg.action === 'unsubscribe' && typeof msg.guildId === 'string') {
          botClient.subscribedGuilds.delete(msg.guildId);
        }
      } catch { /* ignore bad messages */ }
    });

    ws.on('close', () => {
      this.clients.delete(botClient);
      // Stop push timer if no clients
      if (this.clients.size === 0) {
        this.stopPushLoop();
      }
    });

    ws.on('error', () => {
      this.clients.delete(botClient);
      if (this.clients.size === 0) {
        this.stopPushLoop();
      }
    });
  }

  private startPushLoop(): void {
    if (this.pushTimer) return;
    this.pushTimer = setInterval(() => this.pushAll(), PUSH_INTERVAL_MS);
  }

  private stopPushLoop(): void {
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
      this.pushTimer = null;
    }
    // Clear cache
    this.lastGuildListJson = '';
    this.lastGuildStateJson.clear();
  }

  private pushAll(): void {
    if (this.clients.size === 0) return;

    const client = this.getClient();

    // Push guild list (only if changed)
    const guilds = client ? getActiveGuilds(client) : [];
    const guildListJson = JSON.stringify({ type: 'guildList', guilds });
    if (guildListJson !== this.lastGuildListJson) {
      this.lastGuildListJson = guildListJson;
      for (const botClient of this.clients) {
        if (botClient.ws.readyState === WebSocket.OPEN) {
          botClient.ws.send(guildListJson);
        }
      }
    }

    if (!client) return;

    // Collect all subscribed guildIds
    const subscribedGuildIds = new Set<string>();
    for (const botClient of this.clients) {
      for (const guildId of botClient.subscribedGuilds) {
        subscribedGuildIds.add(guildId);
      }
    }

    // Push each subscribed guild's state (only if changed)
    for (const guildId of subscribedGuildIds) {
      const state = getGuildState(guildId, client);
      const stateJson = JSON.stringify({ type: 'guildState', ...(state || { guildId, disconnected: true }) });

      if (stateJson !== this.lastGuildStateJson.get(guildId)) {
        this.lastGuildStateJson.set(guildId, stateJson);
        for (const botClient of this.clients) {
          if (botClient.subscribedGuilds.has(guildId) && botClient.ws.readyState === WebSocket.OPEN) {
            botClient.ws.send(stateJson);
          }
        }
      }
    }

    // Clean up cache for unsubscribed guilds
    for (const guildId of this.lastGuildStateJson.keys()) {
      if (!subscribedGuildIds.has(guildId)) {
        this.lastGuildStateJson.delete(guildId);
      }
    }
  }

  private pushGuildStateTo(botClient: BotClient, guildId: string): void {
    const client = this.getClient();
    if (!client) return;

    const state = getGuildState(guildId, client);
    if (state && botClient.ws.readyState === WebSocket.OPEN) {
      botClient.ws.send(JSON.stringify({ type: 'guildState', ...state }));
    }
  }
}
