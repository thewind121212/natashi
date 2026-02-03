// Go Metadata Endpoint Tests (Category 1)
// Requires Go server running on :8180

const API_BASE = 'http://localhost:8180';

interface MetadataResponse {
  url: string;
  title: string;
  duration: number;
  thumbnail: string;
  error?: string;
}

async function assert(condition: boolean, message: string): Promise<void> {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function testHealthCheck(): Promise<void> {
  console.log('T6.0: Health check');
  const res = await fetch(`${API_BASE}/health`);
  await assert(res.ok, 'Health endpoint returns 200');
  const data = await res.json();
  await assert(data.status === 'ok', 'Health status is ok');
}

async function testValidYouTubeURL(): Promise<void> {
  console.log('\nT6.1: Valid YouTube URL');
  // Using a known short video
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" - first YouTube video
  const res = await fetch(`${API_BASE}/metadata?url=${encodeURIComponent(testUrl)}`);

  await assert(res.ok, 'Returns 200 for valid URL');
  const data: MetadataResponse = await res.json();
  await assert(data.url === testUrl, 'Response includes original URL');
  await assert(typeof data.title === 'string' && data.title.length > 0, 'Has title');
  await assert(typeof data.duration === 'number' && data.duration > 0, 'Has duration');
  console.log(`    Title: "${data.title}", Duration: ${data.duration}s`);
}

async function testInvalidURL(): Promise<void> {
  console.log('\nT6.2: Invalid URL (non-YouTube)');
  const res = await fetch(`${API_BASE}/metadata?url=${encodeURIComponent('https://example.com/video')}`);

  await assert(res.status === 400, 'Returns 400 for non-YouTube URL');
  const data: MetadataResponse = await res.json();
  await assert(typeof data.error === 'string', 'Has error message');
  console.log(`    Error: "${data.error}"`);
}

async function testMissingURLParam(): Promise<void> {
  console.log('\nT6.3: Missing URL parameter');
  const res = await fetch(`${API_BASE}/metadata`);

  await assert(res.status === 400, 'Returns 400 for missing URL');
  const data: MetadataResponse = await res.json();
  await assert(typeof data.error === 'string', 'Has error message');
  console.log(`    Error: "${data.error}"`);
}

async function runTests(): Promise<void> {
  console.log('\n=== Go Metadata Endpoint Tests ===\n');

  try {
    await testHealthCheck();
    await testValidYouTubeURL();
    await testInvalidURL();
    await testMissingURLParam();
    console.log('\n=== All Metadata Endpoint Tests PASSED ===\n');
  } catch (err) {
    console.error('\n=== TEST FAILED ===');
    console.error(err);
    process.exit(1);
  }
}

runTests();
