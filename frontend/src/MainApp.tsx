import React, { useState } from 'react';
import './App.css';
import ModelDashboard from './ModelDashboard.tsx';

interface Message {
  sender: 'user' | 'ai';
  text: string;
}

const API_URL = 'http://localhost:8000/chat';

function MainApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [manualText, setManualText] = useState(''); // State for manual text input
  const [loading, setLoading] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFileUploadError(null);
      setFileUploading(true);
      const selectedFile = e.target.files[0];
      setFileId(null); // Clear previous file ID
      setFileName(null);
      const maxFileSize = 10 * 1024 * 1024; // 10MB
      if (selectedFile.size > maxFileSize) {
        setFileUploadError('File size exceeds 10MB limit.');
        setFileUploading(false);
        return;
      }
      const formData = new FormData();
      formData.append('file', selectedFile);
      try {
        const res = await fetch('/upload', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Upload failed');
        }
        const data = await res.json();
        setFileId(data.file_id);
        setFileName(data.filename);
        setFileUploading(false);
        // Do NOT send a message after upload; wait for user to click Send
      } catch (err: any) {
        setFileUploadError(err.message || 'File upload failed.');
        setFileId(null);
        setFileName(null);
        setFileUploading(false);
      }
    }
  };

  const sendMessage = async (overrideFileId?: string, overrideFileName?: string, isNewFile?: boolean) => {
    const currentFileId = typeof overrideFileId === 'string' ? overrideFileId : fileId;
    const currentFileName = typeof overrideFileName === 'string' ? overrideFileName : fileName;
  
    if (!input.trim() && !currentFileId && !manualText.trim()) return;
  
    let userText = input;
    if (!input.trim() && currentFileName) {
      userText = `[File attached: ${currentFileName}]`;
    } else if (!input.trim() && manualText.trim()) {
      userText = `[Manual text provided]`;
    }
    const userMessage: Message = { sender: 'user', text: userText };
    setMessages((msgs) => [...msgs, userMessage]);
    setLoading(true);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: input || null,
          file_id: currentFileId || null,
          manual_text: manualText.trim() ? manualText : null,  // Send manual text
        }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Request failed with status ${res.status}`);
      }
      const data = await res.json();
      setMessages((msgs) => [...msgs, { sender: 'ai', text: data.response }]);
    } catch (err: any) {
      console.error('Error in sendMessage:', err);
      setMessages((msgs) => [...msgs, { sender: 'ai', text: `Error: ${err.message || 'Could not get response.'}` }]);
    }
    setInput('');
    setLoading(false);
    if (isNewFile) {
      setFileUploadError(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') sendMessage();
  };

  return (
    <>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <a href="/dashboard" onClick={e => { e.preventDefault(); setShowDashboard(v => !v); }} style={{ color: '#007bff', cursor: 'pointer', textDecoration: 'underline' }}>
          Model Dashboard
        </a>
      </div>
      {showDashboard && <ModelDashboard />}
      <div className="App" style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'sans-serif' }}>
        <h2 style={{ textAlign: 'center' }}>Small Language Model Testing</h2>
        <div style={{ border: '1px solid #ccc', borderRadius: 8, padding: 16, minHeight: 300, background: '#fafafa', marginBottom: 16 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ textAlign: msg.sender === 'user' ? 'right' : 'left', margin: '8px 0' }}>
              <span style={{ fontWeight: msg.sender === 'user' ? 600 : 400 }}>
                {msg.sender === 'user' ? 'You' : 'Model'}:
              </span> {msg.text}
            </div>
          ))}
          {loading && <div><em>Model is typing...</em></div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: '#555' }}>Paste document text (optional):</label>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)} // Use setManualText
            placeholder="Paste document text here..."
            style={{ width: '100%', height: 100, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
            disabled={loading}
          />
          <input type="file" onChange={handleFileChange} disabled={fileUploading || loading} accept=".txt,.pdf" />
          {fileUploading && <span style={{ fontSize: 12, color: '#007bff' }}>Uploading...</span>}
          {fileUploadError && <span style={{ fontSize: 12, color: 'red' }}>{fileUploadError}</span>}
          {fileName && !fileUploading && !fileUploadError && (
            <span style={{ fontSize: 12, color: '#555' }}>Attached: {fileName}</span>
          )}
          {fileId && !fileUploading && !fileUploadError && (
            <button
              style={{
                fontSize: 12,
                color: '#fff',
                background: '#dc3545',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                marginLeft: 8,
                cursor: 'pointer',
              }}
              onClick={() => {
                setFileId(null);
                setFileName(null);
              }}
              disabled={loading}
            >
              Remove File
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || (!input.trim() && !fileId) || fileUploading}
            style={{ padding: '8px 16px', borderRadius: 4 }}
          >
            {fileUploading ? 'Uploading...' : 'Send'}
          </button>
        </div>
      </div>
    </>
  );
}

export default MainApp;