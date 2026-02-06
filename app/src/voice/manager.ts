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
} from '@discordjs/voice';
import { Readable } from 'stream';

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
}

export const voiceManager = new VoiceManager();
