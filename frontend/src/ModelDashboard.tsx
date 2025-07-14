import React, { useState } from 'react';

interface Status {
  docker_running: boolean;
  model_available: boolean;
}

export default function ModelDashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const fetchStatus = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/ollama/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      setMessage('Failed to fetch status');
    }
    setLoading(false);
  };

  const startOllama = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/ollama/start', { method: 'POST' });
      const data = await res.json();
      setMessage(data.started ? 'Ollama started!' : 'Ollama already running.');
      fetchStatus();
    } catch (e) {
      setMessage('Failed to start Ollama');
    }
    setLoading(false);
  };

  const pullModel = async () => {
    setLoading(true);
    setMessage('');
    try {
      const res = await fetch('/ollama/pull_model', { method: 'POST' });
      const data = await res.json();
      setMessage(data.pulled ? 'Model pull started or already available.' : 'Failed to pull model.');
      fetchStatus();
    } catch (e) {
      setMessage('Failed to pull model');
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 500, margin: '32px auto', padding: 24, background: '#fff', borderRadius: 12, boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
      <h3>Ollama & Model Dashboard</h3>
      <button onClick={fetchStatus} disabled={loading} style={{ marginRight: 8 }}>Check Status</button>
      <button onClick={startOllama} disabled={loading} style={{ marginRight: 8 }}>Start Ollama</button>
      <button onClick={pullModel} disabled={loading}>Pull Model</button>
      <div style={{ marginTop: 16 }}>
        {loading && <div>Working...</div>}
        {status && (
          <div>
            <div>Ollama Docker: <b style={{ color: status.docker_running ? 'green' : 'red' }}>{status.docker_running ? 'Running' : 'Not Running'}</b></div>
            <div>Model Available: <b style={{ color: status.model_available ? 'green' : 'red' }}>{status.model_available ? 'Yes' : 'No'}</b></div>
          </div>
        )}
        {message && <div style={{ marginTop: 8, color: '#555' }}>{message}</div>}
      </div>
    </div>
  );
} 