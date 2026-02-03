// Queue Manager (c3-103) - Manages playlist state for playground

import { EventEmitter } from 'events';

export interface Track {
  url: string;
  title: string;
  duration: number; // seconds
  thumbnail?: string;
  addedAt: Date;
}

export interface QueueState {
  queue: Track[];
  currentIndex: number;
  nowPlaying: Track | null;
}

export class QueueManager extends EventEmitter {
  private queue: Track[] = [];
  private currentIndex: number = -1; // -1 means nothing playing

  addTrack(url: string, title: string, duration: number, thumbnail?: string): void {
    const track: Track = {
      url,
      title,
      duration,
      thumbnail,
      addedAt: new Date(),
    };
    this.queue.push(track);
    this.emitUpdate();
  }

  removeTrack(index: number): boolean {
    if (index < 0 || index >= this.queue.length) {
      return false;
    }

    this.queue.splice(index, 1);

    // Adjust currentIndex if needed
    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (index === this.currentIndex) {
      // Current track was removed, will need to handle externally
      this.currentIndex = Math.min(this.currentIndex, this.queue.length - 1);
    }

    this.emitUpdate();
    return true;
  }

  // Start playing from beginning or specific index
  startPlaying(index: number = 0): Track | null {
    if (index < 0 || index >= this.queue.length) {
      return null;
    }
    this.currentIndex = index;
    this.emitUpdate();
    return this.queue[this.currentIndex];
  }

  // Get next track and advance index
  skip(): Track | null {
    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      this.emitUpdate();
      return this.queue[this.currentIndex];
    }
    // No more tracks
    return null;
  }

  // Get previous track and go back
  previous(): Track | null {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.emitUpdate();
      return this.queue[this.currentIndex];
    }
    // Already at start
    return null;
  }

  // Called when current track finishes naturally
  currentFinished(): Track | null {
    return this.skip();
  }

  clear(): void {
    this.queue = [];
    this.currentIndex = -1;
    this.emitUpdate();
  }

  getQueue(): Track[] {
    return [...this.queue];
  }

  getCurrentTrack(): Track | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  }

  getNextTrack(): Track | null {
    if (this.currentIndex < this.queue.length - 1) {
      return this.queue[this.currentIndex + 1];
    }
    return null;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  hasNext(): boolean {
    return this.currentIndex < this.queue.length - 1;
  }

  hasPrevious(): boolean {
    return this.currentIndex > 0;
  }

  getState(): QueueState {
    return {
      queue: this.getQueue(),
      currentIndex: this.currentIndex,
      nowPlaying: this.getCurrentTrack(),
    };
  }

  private emitUpdate(): void {
    this.emit('update', this.getState());
  }
}
