import React, { useState, useEffect } from 'react';

const API_BASE = "https://hendy-video-studio-pro.ngogiaidy56.workers.dev";
const WS_BASE = "wss://hendy-video-studio-pro.ngogiaidy56.workers.dev/ws";

interface Project {
  id: string;
  title: string;
  prompt: string;
  status: string;
  created_at: string;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [wsStatus, setWsStatus] = useState('Disconnected');

  // Lấy danh sách dự án
  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      const data = await res.json();
      setProjects(data);
    } catch (err) {
      console.error("Lỗi tải danh sách:", err);
    }
  };

  useEffect(() => {
    fetchProjects();

    // Kết nối WebSocket Real-time
    const ws = new WebSocket(WS_BASE);
    ws.onopen = () => setWsStatus('Connected');
    ws.onmessage = (event) => {
      console.log("WS Event Received:", event.data);
      fetchProjects(); // Reload lại danh sách khi có sự kiện mới
    };
    ws.onclose = () => setWsStatus('Disconnected');

    return () => ws.close();
  }, []);

  // Gửi lệnh tạo Render
  const handleRender = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, prompt }),
      });
      const result = await res.json();
      if (result.success) {
        setTitle('');
        setPrompt('');
        fetchProjects();
      }
    } catch (err) {
      console.error("Lỗi gửi yêu cầu render:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', backgroundColor: '#121212', color: '#fff', minHeight: '100vh' }}>
      <h1>🎬 Hendy Video Studio Pro</h1>
      <p>WebSocket Status: <span style={{ color: wsStatus === 'Connected' ? '#00ff88' : '#ff4444' }}>{wsStatus}</span></p>

      <form onSubmit={handleRender} style={{ marginBottom: '30px', background: '#1e1e1e', padding: '20px', borderRadius: '8px' }}>
        <h2>Tạo Video Mới</h2>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="text"
            placeholder="Tên dự án..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '4px', border: 'none' }}
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <textarea
            placeholder="Nhập prompt mô tả video..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: 'none' }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{ padding: '10px 20px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          {loading ? 'Đang gửi yêu cầu...' : 'Khởi tạo Render'}
        </button>
      </form>

      <h2>Danh sách Dự án</h2>
      <div style={{ display: 'grid', gap: '10px' }}>
        {projects.map((item) => (
          <div key={item.id} style={{ background: '#252525', padding: '15px', borderRadius: '6px' }}>
            <h3>{item.title}</h3>
            <p><strong>Prompt:</strong> {item.prompt}</p>
            <p><strong>Trạng thái:</strong> <span style={{ color: item.status === 'completed' ? '#00ff88' : '#ffaa00' }}>{item.status}</span></p>
            <small>{new Date(item.created_at).toLocaleString()}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
