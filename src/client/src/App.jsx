import { useState, useEffect } from 'react'
import './App.css'

// Define API URL - use relative path since we're using a proxy
const API_URL = ''

function App() {
  const [url, setUrl] = useState('')
  const [sessionId, setSessionId] = useState(null)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState(null)
  const [viewMode, setViewMode] = useState('list') // 'list' or 'view'
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalSessions, setTotalSessions] = useState(0)
  const [sessionData, setSessionData] = useState(null)
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [recordedSessions, setRecordedSessions] = useState([])
  const [showRecordingModal, setShowRecordingModal] = useState(false)
  const [currentSession, setCurrentSession] = useState(null)
  const [currentUrl, setCurrentUrl] = useState(null)
  const [recordingStatus, setRecordingStatus] = useState('idle')
  const [recordedUrl, setRecordedUrl] = useState(null)

  // Fetch recorded sessions on component mount
  useEffect(() => {
    fetchSessions()
  }, [])

  const fetchSessions = async () => {
    try {
      const response = await fetch(`/api/sessions?page=${currentPage}&limit=10`)
      const data = await response.json()
      
      if (response.ok) {
        setSessions(data.sessions)
        setTotalPages(data.pagination.totalPages)
        setTotalSessions(data.pagination.total)
        setError(null)
      } else {
        setError(data.error || 'Failed to fetch sessions')
      }
    } catch (err) {
      setError('Failed to connect to server')
    }
  }

  const startRecording = async () => {
    if (!url) {
      setError('Please enter a URL');
      return;
    }

    try {
      setError(null);
      setIsRecording(true);
      setViewMode('view');

      const response = await fetch('/api/start-recording', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        throw new Error('Failed to start recording');
      }

      const data = await response.json();
      setSelectedSession(data.sessionId);
      await fetchSessionData(data.sessionId);
    } catch (err) {
      setError(err.message);
      setIsRecording(false);
    }
  };

  const handleStopRecording = async () => {
    if (!selectedSession) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/stop-recording', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: selectedSession }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to stop recording');
      }

      const data = await response.json();
      
      // Refresh sessions list after stopping recording
      await fetchSessions();
      
      // Clear selected session
      setSelectedSession(null);
      setCurrentSessionId(null);
      setRecordingStatus('idle');
      setRecordedUrl(null);
      setCurrentUrl(null);
      setCurrentSession(null);
      setIsRecording(false);
      setShowRecordingModal(false);
    } catch (error) {
      console.error('Error stopping recording:', error);
      alert('Failed to stop recording: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewReplay = async (sessionId) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch session data');
      }
      const sessionData = await response.json();
      setSessionData(sessionData);
      setCurrentSession(sessionData);
      setCurrentUrl(sessionData.url);
      setCurrentSessionId(sessionId);
      setRecordingStatus('viewing');
    } catch (error) {
      console.error('Error fetching session data:', error);
      alert('Failed to load session data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm('Are you sure you want to delete this session?')) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete session');
      }

      // Refresh sessions list
      await fetchSessions();
      
      // If we're viewing the deleted session, clear the view
      if (currentSessionId === sessionId) {
        setCurrentSession(null);
        setCurrentUrl(null);
        setCurrentSessionId(null);
        setRecordingStatus('idle');
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Failed to delete session: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSessionData = async (sessionId) => {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`);
      if (response.ok) {
        const data = await response.json();
        setSessionData(data);
      } else {
        setError('Failed to fetch session data');
      }
    } catch (err) {
      setError('Failed to connect to server');
    }
  };

  const viewSession = async (sessionId) => {
    setSelectedSession(sessionId);
    setViewMode('view');
    await fetchSessionData(sessionId);
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString()
  }

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage)
  }

  return (
    <div className="container">
      <div className={`loading-bar ${isLoading ? 'active' : ''}`} />
      {!sessionData ? (
        <>
          <h1>Web Recorder</h1>
          <div className={`input-group ${isLoading ? 'loading' : ''}`}>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter URL to record"
              disabled={isRecording || isLoading}
            />
            <button
              onClick={isRecording ? handleStopRecording : startRecording}
              disabled={!url || isLoading}
            >
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
          {isRecording && (
            <div className="recording-status">
              <p>Recording in progress...</p>
              <p className="recording-instructions">
                The website is being recorded in a separate browser window.
                You can interact with the website in that window.
                Click "Stop Recording" when you're done.
              </p>
            </div>
          )}
          <div className={`sessions-section ${isLoading ? 'loading' : ''}`}>
            <h2>Recorded Sessions</h2>
            {sessions.length === 0 ? (
              <div className="no-sessions">No recorded sessions yet</div>
            ) : (
              <div className="sessions-grid">
                {sessions.map((session) => (
                  <div key={session._id} className="session-card">
                    <h3>{session.url}</h3>
                    <p>Recorded: {new Date(session.timestamp).toLocaleString()}</p>
                    <div className="session-actions">
                      <button
                        className="view-button"
                        onClick={() => viewSession(session._id)}
                        disabled={isLoading}
                      >
                        View
                      </button>
                      <button
                        className="delete-button"
                        onClick={() => handleDeleteSession(session._id)}
                        disabled={isLoading}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="pagination">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1 || isLoading}
              >
                Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages || isLoading}
              >
                Next
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className={`viewer-section ${isLoading ? 'loading' : ''}`}>
          <div className="viewer-container">
            <div className="viewer-layout">
              <div className="viewer-main">
                <nav className="replay-bar" aria-label="replay">
                  <div className="field has-addons">
                    <a href="#" role="button" className="button narrow is-borderless" title="Back" onClick={(e) => e.preventDefault()}>
                      <span className="icon is-small">
                        <i className="fas fa-arrow-left has-text-grey"></i>
                      </span>
                    </a>
                    <a href="#" role="button" className="button narrow is-borderless" title="Forward" onClick={(e) => e.preventDefault()}>
                      <span className="icon is-small">
                        <i className="fas fa-arrow-right has-text-grey"></i>
                      </span>
                    </a>
                    <a href="#" role="button" className="button narrow is-borderless" title="Reload" onClick={(e) => e.preventDefault()}>
                      <span className="icon is-small">
                        <i className="fas fa-sync has-text-grey"></i>
                      </span>
                    </a>
                    <div className="control is-expanded has-icons-left">
                      <input
                        className="input"
                        type="text"
                        value={sessionData.url}
                        readOnly
                      />
                      <span className="icon is-small is-left">
                        <i className="fas fa-globe has-text-grey"></i>
                      </span>
                    </div>
                    <div className="dropdown">
                      <a href="#" role="button" className="button is-borderless" title="More options" onClick={(e) => e.preventDefault()}>
                        <span className="icon is-small">
                          <i className="fas fa-ellipsis-v has-text-grey"></i>
                        </span>
                      </a>
                      <div className="dropdown-menu">
                        <div className="dropdown-content">
                          <a href="#" className="dropdown-item" onClick={(e) => e.preventDefault()}>
                            <i className="fas fa-download has-text-grey"></i>
                            <span>Download Archive</span>
                          </a>
                          <hr className="dropdown-divider" />
                          <a href="#" className="dropdown-item" onClick={(e) => e.preventDefault()}>
                            <i className="fas fa-info-circle has-text-grey"></i>
                            <span>Archive Info</span>
        </a>
      </div>
                      </div>
                    </div>
                  </div>
                </nav>
                <div className="iframe-container">
                  {sessionData.resources && sessionData.resources.length > 0 ? (
                    sessionData.resources
                      .filter(resource => 
                        resource.contentType.includes('text/html') && 
                        resource.url === sessionData.url
                      )
                      .map((resource) => (
                        <iframe
                          key={resource._id}
                          src={`/api/sessions/${sessionData._id}/resources/${resource._id}`}
                          className="session-viewer"
                          title={`Replay of ${sessionData.url}`}
                          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads"
                          style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            backgroundColor: '#fff'
                          }}
                        />
                      ))
                  ) : (
                    <div className="no-content">
                      No recorded content available
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <button className="back-button" onClick={() => setSessionData(null)} disabled={isLoading}>
            Back to Sessions
        </button>
        </div>
      )}
      </div>
  )
}

export default App
