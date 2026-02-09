// c3-102: Voice Manager - handles Discord voice connections and audio playback

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  VoiceConnection,
  AudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
  DiscordGatewayAdapterCreator,
  AudioPlayerState,
} from '@discordjs/voice';
import { Readable } from 'stream';

// Default timeout for waiting for player to go idle (ms)
const IDLE_TIMEOUT_MS = 5000;

interface GuildVoiceState {
  connection: VoiceConnection;
  player: AudioPlayer;
}

class VoiceManager {
  private guilds = new Map<string, GuildVoiceState>();

  join(
    guildId: string,
    channelId: string,
    adapterCreator: DiscordGatewayAdapterCreator
  ): VoiceConnection {
    const existing = this.guilds.get(guildId);
    if (existing) {
      return existing.connection;
    }

    const connection = joinVoiceChannel({
      channelId,
      guildId,
      adapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    const player = createAudioPlayer();
    connection.subscribe(player);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.leave(guildId);
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      this.guilds.delete(guildId);
    });

    player.on(AudioPlayerStatus.Idle, () => {
      console.log(`[VoiceManager] Player idle for guild ${guildId}`);
    });

    player.on('error', (error) => {
      console.error(`[VoiceManager] Player error:`, error.message);
    });

    this.guilds.set(guildId, { connection, player });
    console.log(`[VoiceManager] Joined voice channel ${channelId} in guild ${guildId}`);
    return connection;
  }

  leave(guildId: string): void {
    const state = this.guilds.get(guildId);
    if (state) {
      state.player.stop();
      state.connection.destroy();
      this.guilds.delete(guildId);
      console.log(`[VoiceManager] Left voice channel in guild ${guildId}`);
    }
  }

  getConnection(guildId: string): VoiceConnection | undefined {
    return this.guilds.get(guildId)?.connection;
  }

  getPlayer(guildId: string): AudioPlayer | undefined {
    return this.guilds.get(guildId)?.player;
  }

  isConnected(guildId: string): boolean {
    return this.guilds.has(guildId);
  }

  playStream(guildId: string, stream: Readable): boolean {
    const state = this.guilds.get(guildId);
    if (!state) {
      console.error(`[VoiceManager] Not connected to guild ${guildId}`);
      return false;
    }

    const resource = createAudioResource(stream, {
      inputType: StreamType.OggOpus,
    });

    state.player.play(resource);
    console.log(`[VoiceManager] Started playing in guild ${guildId}`);
    return true;
  }

  stop(guildId: string): void {
    const state = this.guilds.get(guildId);
    if (state) {
      state.player.stop();
      console.log(`[VoiceManager] Stopped playback in guild ${guildId}`);
    }
  }

  pause(guildId: string): boolean {
    const state = this.guilds.get(guildId);
    if (state) {
      const success = state.player.pause();
      if (success) {
        console.log(`[VoiceManager] Paused playback in guild ${guildId}`);
      }
      return success;
    }
    return false;
  }

  unpause(guildId: string): boolean {
    const state = this.guilds.get(guildId);
    if (state) {
      const success = state.player.unpause();
      if (success) {
        console.log(`[VoiceManager] Resumed playback in guild ${guildId}`);
      }
      return success;
    }
    return false;
  }

  /**
   * Wait for the player to go Idle (finished consuming all buffered audio).
   * Returns true if safe to advance to next track, false if player is still playing.
   * This prevents cutting off audio when auto-advancing tracks.
   */
  waitForIdle(guildId: string, timeoutMs = IDLE_TIMEOUT_MS): Promise<boolean> {
    const state = this.guilds.get(guildId);
    if (!state) {
      return Promise.resolve(true); // No player, safe to advance
    }

    const player = state.player;

    // Already idle? Return immediately
    if (player.state.status === AudioPlayerStatus.Idle) {
      console.log(`[VoiceManager] Player already idle for guild ${guildId}`);
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        player.off('stateChange', handler);
        // Timeout hit - check if STILL playing
        if (player.state.status === AudioPlayerStatus.Playing) {
          console.log(`[VoiceManager] Timeout but still playing for guild ${guildId} - not forcing advance`);
          resolve(false); // Don't advance yet, let it finish naturally
        } else {
          console.log(`[VoiceManager] Timeout and player not playing for guild ${guildId} - safe to advance`);
          resolve(true); // Safe to advance
        }
      }, timeoutMs);

      const handler = (oldState: AudioPlayerState, newState: AudioPlayerState) => {
        if (newState.status === AudioPlayerStatus.Idle) {
          clearTimeout(timeout);
          player.off('stateChange', handler);
          console.log(`[VoiceManager] Player went idle for guild ${guildId} - safe to advance`);
          resolve(true); // Safe to advance
        }
      };

      player.on('stateChange', handler);
    });
  }
}

export const voiceManager = new VoiceManager();
