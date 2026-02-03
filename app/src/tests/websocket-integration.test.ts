// WebSocket Integration Tests (Category 3)
// Requires both Go (:8180) and Node.js (:3000) servers running

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:3000';
const TEST_YOUTUBE_URL = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // Short video

interface WSMessage {
  type: string;
  queue?: Array<{
    url: string;
    title: string;
    duration: number;
  }>;
  currentIndex?: number;
  nowPlaying?: { title: string } | null;
  session_id?: string;
  message?: string;
  [key: string]: unknown;
}

function createWS(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
  });
}

function waitForMessage(ws: WebSocket, type: string, timeout = 30000): Promise<WSMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeout);

    const handler = (data: WebSocket.Data) => {
      try {
        const msg: WSMessage = JSON.parse(data.toString());
        if (msg.type === type) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(msg);
        }
      } catch {
        // Ignore parse errors
      }
    };
    ws.on('message', handler);
  });
}

function send(ws: WebSocket, action: string, data: Record<string, unknown> = {}): void {
  ws.send(JSON.stringify({ action, ...data }));
}

async function assert(condition: boolean, message: string): Promise<void> {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function testConnection(): Promise<WebSocket> {
  console.log('T6.9a: WebSocket connection');
  const ws = await createWS();
  await assert(ws.readyState === WebSocket.OPEN, 'WebSocket connected');

  // Wait for initial state
  const state = await waitForMessage(ws, 'state');
  await assert(state.type === 'state', 'Received initial state');
  await assert(Array.isArray(state.queue), 'State includes queue array');
  return ws;
}

async function testAddToQueue(ws: WebSocket): Promise<void> {
  console.log('\nT6.9: addToQueue action');

  send(ws, 'addToQueue', { url: TEST_YOUTUBE_URL });

  // Wait for queue update
  const update = await waitForMessage(ws, 'queueUpdated');
  await assert(update.queue !== undefined && update.queue.length >= 1, 'Queue has at least 1 track');
  await assert(update.queue![0].url === TEST_YOUTUBE_URL, 'Track URL matches');
  await assert(typeof update.queue![0].title === 'string', 'Track has title');
  await assert(typeof update.queue![0].duration === 'number', 'Track has duration');
  console.log(`    Added: "${update.queue![0].title}"`);
}

async function testGetQueue(ws: WebSocket): Promise<void> {
  console.log('\nT6.12a: getQueue action');

  send(ws, 'getQueue');

  const update = await waitForMessage(ws, 'queueUpdated');
  await assert(update.queue !== undefined, 'Received queue');
  await assert(typeof update.currentIndex === 'number', 'Has currentIndex');
  console.log(`    Queue length: ${update.queue!.length}, currentIndex: ${update.currentIndex}`);
}

async function testSkip(ws: WebSocket): Promise<void> {
  console.log('\nT6.11: skip action');

  // First add another track so we have something to skip to
  send(ws, 'addToQueue', { url: TEST_YOUTUBE_URL });
  await waitForMessage(ws, 'queueUpdated');

  // Now skip
  send(ws, 'skip');

  // Should receive queueUpdated with new currentIndex or queueFinished
  const msg = await Promise.race([
    waitForMessage(ws, 'queueUpdated'),
    waitForMessage(ws, 'queueFinished'),
  ]);

  await assert(
    msg.type === 'queueUpdated' || msg.type === 'queueFinished',
    'Skip triggers queue update or finish'
  );
  console.log(`    Result: ${msg.type}`);
}

async function testClearQueue(ws: WebSocket): Promise<void> {
  console.log('\nT6.12: clearQueue action');

  send(ws, 'clearQueue');

  // Wait for stopped event
  const stopped = await waitForMessage(ws, 'stopped', 5000);
  await assert(stopped.type === 'stopped', 'Received stopped event');

  // Verify queue is empty
  send(ws, 'getQueue');
  const update = await waitForMessage(ws, 'queueUpdated');
  await assert(update.queue !== undefined && update.queue.length === 0, 'Queue is empty');
  console.log('    Queue cleared successfully');
}

async function testRemoveFromQueue(ws: WebSocket): Promise<void> {
  console.log('\nT6.10: removeFromQueue action');

  // Add 2 tracks
  send(ws, 'addToQueue', { url: TEST_YOUTUBE_URL });
  await waitForMessage(ws, 'queueUpdated');
  send(ws, 'addToQueue', { url: TEST_YOUTUBE_URL });
  const addResult = await waitForMessage(ws, 'queueUpdated');
  const initialLength = addResult.queue!.length;

  // Remove first track
  send(ws, 'removeFromQueue', { index: 0 });
  const update = await waitForMessage(ws, 'queueUpdated');

  await assert(update.queue!.length === initialLength - 1, 'Queue length decreased by 1');
  console.log(`    Removed track, queue now has ${update.queue!.length} tracks`);

  // Cleanup
  send(ws, 'clearQueue');
  await waitForMessage(ws, 'stopped');
}

async function runTests(): Promise<void> {
  console.log('\n=== WebSocket Integration Tests ===\n');

  let ws: WebSocket | null = null;

  try {
    ws = await testConnection();
    await testAddToQueue(ws);
    await testGetQueue(ws);
    await testRemoveFromQueue(ws);
    await testSkip(ws);
    await testClearQueue(ws);

    console.log('\n=== All WebSocket Integration Tests PASSED ===\n');
  } catch (err) {
    console.error('\n=== TEST FAILED ===');
    console.error(err);
    process.exit(1);
  } finally {
    if (ws) {
      ws.close();
    }
  }
}

runTests();
