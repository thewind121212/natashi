// Test Runner - Runs all automated tests
// Usage: npx tsx src/tests/run-all.ts

import { spawn, ChildProcess } from 'child_process';
import path from 'path';

const TEST_DIR = path.dirname(new URL(import.meta.url).pathname);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runTest(name: string, file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${name}`);
    console.log('='.repeat(60));

    const proc: ChildProcess = spawn('npx', ['tsx', path.join(TEST_DIR, file)], {
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      resolve({
        name,
        passed: code === 0,
        error: code !== 0 ? `Exit code: ${code}` : undefined,
      });
    });

    proc.on('error', (err) => {
      resolve({
        name,
        passed: false,
        error: err.message,
      });
    });
  });
}

async function main(): Promise<void> {
  console.log('\n' + '█'.repeat(60));
  console.log('  PLAYLIST SUPPORT - AUTOMATED TEST SUITE');
  console.log('█'.repeat(60));

  const results: TestResult[] = [];

  // Category 2: Queue Manager Unit Tests (no server required)
  results.push(await runTest('Category 2: Queue Manager Unit Tests', 'queue-manager.test.ts'));

  // Category 1: Go Metadata Endpoint (requires Go server)
  results.push(await runTest('Category 1: Go Metadata Endpoint Tests', 'api-metadata.test.ts'));

  // Category 3: WebSocket Integration (requires both servers)
  results.push(await runTest('Category 3: WebSocket Integration Tests', 'websocket-integration.test.ts'));

  // Summary
  console.log('\n' + '█'.repeat(60));
  console.log('  TEST SUMMARY');
  console.log('█'.repeat(60) + '\n');

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}  ${r.name}`);
    if (!r.passed) {
      allPassed = false;
      if (r.error) console.log(`        Error: ${r.error}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  if (allPassed) {
    console.log('  ALL TESTS PASSED');
  } else {
    console.log('  SOME TESTS FAILED');
    process.exit(1);
  }
  console.log('='.repeat(60) + '\n');
}

main();
