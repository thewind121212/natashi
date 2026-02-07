import 'dotenv/config';
import { createServer, startServer } from './server';
import { WebSocketHandler } from './websocket';
import { SqliteStore } from './sqlite-store';
import { createServer as createHttpServer } from 'http';
import { config } from './config';

// Suppress @discordjs/voice negative timeout warnings (not a real error, just timing jitter)
process.on('warning', (warning) => {
  if (warning.name === 'TimeoutNegativeWarning') return;
  console.warn(warning);
});
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  MessageFlags,
} from 'discord.js';
import { commands } from './commands';

let discordClient: Client | null = null;

async function startExpressServer(): Promise<void> {
  // Initialize SQLite store for session persistence
  const sqliteStore = new SqliteStore();
  sqliteStore.init();

  const app = createServer(() => discordClient);
  const httpServer = createHttpServer(app);
  const wsHandler = new WebSocketHandler(httpServer, sqliteStore);

  const host = process.env.SERVER_HOST || '0.0.0.0';
  await new Promise<void>((resolve) => {
    httpServer.listen(3000, host, () => {
      console.log(`[Server] Listening on http://${host}:3000`);
      resolve();
    });
  });

  console.log('[Server] Connecting to Go server...');
  try {
    await wsHandler.connect();
    console.log('[Server] Connected to Go server');
  } catch (err) {
    if (config.botToken) {
      console.warn('[Server] Failed to connect to Go server (playground will not work)');
    } else {
      console.error('[Server] Failed to connect to Go server. Make sure it is running.');
      console.error('[Server] Start Go server with: go run cmd/playground/main.go');
      process.exit(1);
    }
  }

  console.log('[Server] Ready! Open http://localhost:3000 in your browser');
}

async function startDiscordBot(): Promise<void> {
  if (!config.botToken) {
    console.log('[Discord] BOT_TOKEN not set, skipping Discord bot');
    return;
  }

  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  discordClient.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);

    const rest = new REST().setToken(config.botToken);
    const commandData = commands.map((cmd) => cmd.data.toJSON());

    // Register commands globally (works on all servers, takes ~1 hour to propagate)
    console.log(`[Discord] Registering ${commandData.length} global commands...`);
    await rest.put(
      Routes.applicationCommands(readyClient.user.id),
      { body: commandData }
    );
    console.log('[Discord] Global commands registered (may take up to 1 hour to appear on new servers)');
    console.log('[Discord] Bot ready!');
  });

  discordClient.on(Events.InteractionCreate, async (interaction) => {
    // Handle autocomplete interactions
    if (interaction.isAutocomplete()) {
      const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
      if (!command || !('autocomplete' in command)) return;

      try {
        await (command as { autocomplete: (i: typeof interaction) => Promise<void> }).autocomplete(interaction);
      } catch (error) {
        console.error(`[Discord] Autocomplete error for ${interaction.commandName}:`, error);
      }
      return;
    }

    // Handle slash command interactions
    if (!interaction.isChatInputCommand()) return;

    const command = commands.find((cmd) => cmd.data.name === interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`[Discord] Error executing ${interaction.commandName}:`, error);
      const reply = { content: 'An error occurred.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  });

  await discordClient.login(config.botToken);
}

async function main(): Promise<void> {
  console.log('=== Audio Playground (Node.js) ===');
  if (config.debugAudio) {
    console.log('[WebSocket] Debug mode enabled via DEBUG_AUDIO=1');
  }

  // Log access control status
  if (config.allowedDiscordIds.length > 0) {
    console.log(`[Auth] Whitelist enabled: ${config.allowedDiscordIds.length} user(s) allowed`);
    console.log(`[Auth] Allowed IDs: ${config.allowedDiscordIds.join(', ')}`);
  } else {
    console.log('[Auth] Whitelist disabled (all users allowed)');
  }

  // Start Express server (always)
  await startExpressServer();

  // Start Discord bot (if configured)
  await startDiscordBot();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n[Server] Shutting down...');
    if (discordClient) {
      discordClient.destroy();
    }
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
