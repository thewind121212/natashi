// Queue Manager Unit Tests (Category 2)

import { QueueManager } from '../queue-manager';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

function runTests(): void {
  console.log('\n=== Queue Manager Unit Tests ===\n');

  // T6.4: Add track
  console.log('T6.4: Add track');
  {
    const qm = new QueueManager();
    assert(qm.isEmpty(), 'Queue starts empty');
    qm.addTrack('http://example.com/1', 'Track 1', 120, 'thumb1.jpg');
    assert(qm.getQueue().length === 1, 'Queue has 1 track after add');
    assert(qm.getQueue()[0].title === 'Track 1', 'Track title is correct');
    assert(qm.getQueue()[0].duration === 120, 'Track duration is correct');
  }

  // T6.5: Remove track
  console.log('\nT6.5: Remove track');
  {
    const qm = new QueueManager();
    qm.addTrack('http://example.com/1', 'Track 1', 100);
    qm.addTrack('http://example.com/2', 'Track 2', 200);
    qm.addTrack('http://example.com/3', 'Track 3', 300);
    assert(qm.getQueue().length === 3, 'Queue has 3 tracks');

    const removed = qm.removeTrack(1);
    assert(removed === true, 'Remove returns true');
    assert(qm.getQueue().length === 2, 'Queue has 2 tracks after remove');
    assert(qm.getQueue()[1].title === 'Track 3', 'Track 3 moved to index 1');

    const invalidRemove = qm.removeTrack(99);
    assert(invalidRemove === false, 'Remove invalid index returns false');
  }

  // T6.6: Skip
  console.log('\nT6.6: Skip');
  {
    const qm = new QueueManager();
    qm.addTrack('http://example.com/1', 'Track 1', 100);
    qm.addTrack('http://example.com/2', 'Track 2', 200);
    qm.addTrack('http://example.com/3', 'Track 3', 300);

    qm.startPlaying(0);
    assert(qm.getCurrentIndex() === 0, 'Start at index 0');
    assert(qm.getCurrentTrack()?.title === 'Track 1', 'Current is Track 1');

    const next = qm.skip();
    assert(next?.title === 'Track 2', 'Skip returns Track 2');
    assert(qm.getCurrentIndex() === 1, 'Index is now 1');

    qm.skip();
    assert(qm.getCurrentIndex() === 2, 'Index is now 2');

    const noMore = qm.skip();
    assert(noMore === null, 'Skip at end returns null');
  }

  // T6.7: Clear
  console.log('\nT6.7: Clear');
  {
    const qm = new QueueManager();
    qm.addTrack('http://example.com/1', 'Track 1', 100);
    qm.addTrack('http://example.com/2', 'Track 2', 200);
    qm.startPlaying(0);

    assert(!qm.isEmpty(), 'Queue not empty before clear');
    qm.clear();
    assert(qm.isEmpty(), 'Queue empty after clear');
    assert(qm.getCurrentIndex() === -1, 'Index reset to -1');
    assert(qm.getCurrentTrack() === null, 'No current track');
  }

  // T6.8: Auto-advance (currentFinished)
  console.log('\nT6.8: Auto-advance (currentFinished)');
  {
    const qm = new QueueManager();
    qm.addTrack('http://example.com/1', 'Track 1', 100);
    qm.addTrack('http://example.com/2', 'Track 2', 200);
    qm.startPlaying(0);

    const next = qm.currentFinished();
    assert(next?.title === 'Track 2', 'currentFinished returns next track');
    assert(qm.getCurrentIndex() === 1, 'Index advanced');

    const noMore = qm.currentFinished();
    assert(noMore === null, 'No more tracks returns null');
  }

  // Additional: getState, hasNext, getNextTrack
  console.log('\nAdditional: State helpers');
  {
    const qm = new QueueManager();
    qm.addTrack('http://example.com/1', 'Track 1', 100);
    qm.addTrack('http://example.com/2', 'Track 2', 200);
    qm.startPlaying(0);

    assert(qm.hasNext() === true, 'hasNext is true');
    assert(qm.getNextTrack()?.title === 'Track 2', 'getNextTrack returns Track 2');

    const state = qm.getState();
    assert(state.queue.length === 2, 'State has queue');
    assert(state.currentIndex === 0, 'State has currentIndex');
    assert(state.nowPlaying?.title === 'Track 1', 'State has nowPlaying');
  }

  console.log('\n=== All Queue Manager Tests PASSED ===\n');
}

runTests();
