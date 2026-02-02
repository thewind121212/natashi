// Audio Playground Client
(function() {
  const urlInput = document.getElementById('url');
  const playBtn = document.getElementById('play');
  const stopBtn = document.getElementById('stop');
  const status = document.getElementById('status');
  const debugCheckbox = document.getElementById('debug');

  let ws = null;
  let sessionId = null;
  let debugMode = false;
  let playStartTime = null;
  let progressInterval = null;

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
      setStatus('Connected to server', 'success');
    };

    ws.onclose = () => {
      setStatus('Disconnected from server', 'error');
      setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      setStatus('Connection error', 'error');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'debug_mode':
        debugMode = msg.enabled;
        debugCheckbox.checked = debugMode;
        break;

      case 'session':
        sessionId = msg.session_id;
        setStatus('Extracting audio...');
        break;

      case 'ready':
        const readyTime = Date.now() - playStartTime;
        if (debugMode) {
          setStatus('▶ Playing (ready in ' + readyTime + 'ms)', 'success');
        } else {
          setStatus('Streaming... (debug OFF - no audio)', 'success');
        }
        playBtn.disabled = true;
        stopBtn.disabled = false;
        // Start progress tracking
        startProgressTracking();
        break;

      case 'progress':
        const playbackTime = formatTime(msg.playback_secs || 0);
        if (debugMode) {
          setStatus('▶ ' + playbackTime + ' buffered | ' + formatBytes(msg.bytes), 'success');
        } else {
          setStatus(playbackTime + ' buffered | ' + formatBytes(msg.bytes), 'success');
        }
        break;

      case 'error':
        stopProgressTracking();
        setStatus('Error: ' + msg.message, 'error');
        resetState();
        break;

      case 'finished':
        stopProgressTracking();
        const totalTime = playStartTime ? ((Date.now() - playStartTime) / 1000).toFixed(1) : '?';
        setStatus('✓ Finished in ' + totalTime + 's | Total: ' + formatBytes(msg.bytes || 0));
        resetState();
        break;

      case 'player_stopped':
        stopProgressTracking();
        setStatus('Playback stopped');
        resetState();
        break;
    }
  }

  function resetState() {
    playBtn.disabled = false;
    stopBtn.disabled = true;
    sessionId = null;
    playStartTime = null;
  }

  function startProgressTracking() {
    // Progress is now updated via 'progress' messages from server
  }

  function stopProgressTracking() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function setStatus(message, type = '') {
    status.textContent = message;
    status.className = type;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatTime(secs) {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return mins + ':' + (s < 10 ? '0' : '') + s;
  }

  // Debug checkbox
  debugCheckbox.onchange = () => {
    ws.send(JSON.stringify({
      action: 'set_debug',
      enabled: debugCheckbox.checked
    }));
  };

  // Play button
  playBtn.onclick = () => {
    const url = urlInput.value.trim();
    if (!url) {
      setStatus('Please enter a YouTube URL', 'error');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus('Not connected to server', 'error');
      return;
    }

    playStartTime = Date.now();
    setStatus('Starting... (0ms)');
    ws.send(JSON.stringify({
      action: 'play',
      url: url
    }));
  };

  // Stop button
  stopBtn.onclick = () => {
    ws.send(JSON.stringify({ action: 'stop' }));
    setStatus('Stopping...');
  };

  // Enter key to play
  urlInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      playBtn.click();
    }
  };

  connect();
})();
