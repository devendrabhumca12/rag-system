import { useState, useRef, useEffect } from 'react';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [uploaded, setUploaded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://localhost:3001/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (response.ok) {
        setUploaded(true);
        setFile(null);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage = input;
    setMessages((prev) => [...prev, { type: 'user', text: userMessage }]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:3001/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMessage }),
      });

      const data = await response.json();

      if (response.ok && data.matches && data.matches.length > 0) {
        setMessages((prev) => [
          ...prev,
          {
            type: 'bot',
            matches: data.matches,
            total: data.total_found,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { type: 'bot', text: 'No matching content found in your resume.' },
        ]);
      }
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        { type: 'bot', text: `Error: ${error.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = [
    'What is my experience?',
    'What are my technical skills?',
    'What projects have I worked on?',
    'Tell me about my education',
  ];

  const handleSuggestion = (suggestion) => {
    setInput(suggestion);
  };

  return (
    <div className="App">
      {!uploaded ? (
        <div className="upload-page">
          <div className="upload-container">
            <div className="upload-header">
              <h1>Resume Q&A</h1>
              <p>Chat with your resume</p>
            </div>

            <div className="upload-main">
              <input
                type="file"
                accept=".pdf,.txt"
                onChange={handleFileChange}
                id="file-input"
                disabled={loading}
              />
              <label htmlFor="file-input" className="file-input-label">
                <div className="file-icon">📄</div>
                <div className="file-text">
                  {file ? (
                    <>
                      <span className="file-name">{file.name}</span>
                      <span className="file-ready">Ready to upload</span>
                    </>
                  ) : (
                    <>
                      <span className="file-name">Click to upload or drag and drop</span>
                      <span className="file-hint">PDF or TXT (max 50MB)</span>
                    </>
                  )}
                </div>
              </label>

              <button
                onClick={handleUpload}
                disabled={loading || !file}
                className="upload-submit"
              >
                {loading ? 'Uploading...' : 'Upload & Chat'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="chat-page">
          <div className="chat-wrapper">
            <div className="messages-area">
              {messages.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-header">
                    <h2>Resume Assistant</h2>
                    <p>Ask questions about your resume</p>
                  </div>

                  <div className="suggestions">
                    <p className="suggestions-title">Try asking:</p>
                    <div className="suggestions-grid">
                      {suggestions.map((suggestion, idx) => (
                        <button
                          key={idx}
                          className="suggestion-card"
                          onClick={() => handleSuggestion(suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="messages-list">
                  {messages.map((msg, idx) => (
                    <div key={idx} className={`message ${msg.type}`}>
                      <div className="message-content">
                        {msg.type === 'user' ? (
                          <div className="user-text">{msg.text}</div>
                        ) : msg.matches ? (
                          <div className="bot-matches">
                            {msg.matches.map((match, midx) => (
                              <div key={midx} className="match-card">
                                <p>{match}</p>
                              </div>
                            ))}
                            {msg.total > msg.matches.length && (
                              <div className="match-count">
                                Showing {msg.matches.length} of {msg.total} matches
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bot-text">{msg.text}</div>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="message bot">
                      <div className="message-content">
                        <div className="typing-indicator">
                          <span></span>
                          <span></span>
                          <span></span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div className="input-area">
              <div className="input-wrapper">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !loading && handleSend()}
                  placeholder="Ask about your resume..."
                  disabled={loading}
                  autoFocus
                />
                <button
                  onClick={handleSend}
                  disabled={loading || !input.trim()}
                  className="send-btn"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 1L14 8L8 15M1 8H13.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <p className="input-hint">Powered by semantic search</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
