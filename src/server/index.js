const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const fs = require('fs-extra');
const Recorder = require('./services/recorder');
const Session = require('./models/Session');
const s3 = require('./services/s3');
const zlib = require('zlib');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Validate environment variables
console.log('Environment variables:');
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('AWS_S3_BUCKET:', process.env.AWS_S3_BUCKET);
console.log('AWS_ACCESS_KEY_ID:', process.env.AWS_ACCESS_KEY_ID ? '***' + process.env.AWS_ACCESS_KEY_ID.slice(-4) : undefined);
console.log('AWS_SECRET_ACCESS_KEY:', process.env.AWS_SECRET_ACCESS_KEY ? '***' + process.env.AWS_SECRET_ACCESS_KEY.slice(-4) : undefined);

// Middleware
app.use(cors());
app.use(express.json());

// Initialize MongoDB connection
async function initializeMongoDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// Initialize S3
async function initializeS3() {
  try {
    await s3.initialize();
    console.log('S3 service initialized successfully');
  } catch (err) {
    console.error('S3 initialization error:', err);
    console.log('Warning: S3 service failed to initialize. File uploads will not work.');
    // Don't throw the error, just log it
  }
}

// Store active recording sessions
const activeSessions = new Map();

// Routes
app.post('/api/start-recording', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Create a new session ID
    const sessionId = new mongoose.Types.ObjectId().toString();

    // Start recording
    await Recorder.startRecording(url, sessionId);
    
    res.json({ sessionId, message: 'Recording started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/stop-recording', async (req, res) => {
  const { sessionId } = req.body;
  console.log('Stopping recording for session:', sessionId);

  if (!sessionId) {
    console.error('No session ID provided');
    return res.status(400).json({ error: 'Session ID is required' });
  }

  try {
    // First check if the session exists and is still recording
    const existingSession = await Session.findById(sessionId);
    if (!existingSession) {
      console.error('Session not found:', sessionId);
      return res.status(404).json({ error: 'Session not found' });
    }

    if (existingSession.status !== 'recording') {
      console.error('Session is not in recording state:', sessionId);
      return res.status(400).json({ error: 'Session is not currently recording' });
    }

    // Stop the recording
    const session = await Recorder.stopRecording(sessionId);
    if (!session) {
      console.error('No active recording found for session:', sessionId);
      return res.status(404).json({ error: 'No active recording found for this session' });
    }

    // Update session status in database
    existingSession.status = 'completed';
    existingSession.timestamp = new Date();
    await existingSession.save();

    console.log('Recording stopped successfully for session:', sessionId);
    res.json({ 
      message: 'Recording stopped successfully',
      metadata: {
        _id: session._id,
        url: session.url,
        timestamp: session.timestamp,
        status: session.status,
        startTime: session.startTime,
        resourceCount: session.resources.length
      }
    });
  } catch (error) {
    console.error('Error stopping recording:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to stop recording',
      details: error.stack
    });
  }
});

// List all recorded sessions
app.get('/api/sessions', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get total count first
    const total = await Session.countDocuments();
    
    // Get paginated sessions
    const sessions = await Session.find()
      .sort({ timestamp: -1 })
      .select('url timestamp status resources startTime')
      .skip(skip)
      .limit(limit)
      .allowDiskUse(true)
      .lean(); // Convert to plain JavaScript objects
    
    console.log(`Found ${sessions.length} sessions (page ${page}, limit ${limit})`);
    
    res.json({ 
      sessions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Failed to fetch sessions from database'
    });
  }
});

// Delete a session
app.delete('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Delete S3 files
    for (const resource of session.resources) {
      if (resource.isS3 && resource.s3Key) {
        await s3.deleteFile(resource.s3Key);
      }
    }

    // Delete session document
    await Session.findByIdAndDelete(sessionId);
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session data
app.get('/api/sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Include all session data including resources
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get session resource
app.get('/api/sessions/:sessionId/resources/:resourceId', async (req, res) => {
  const { sessionId, resourceId } = req.params;
  
  try {
    // Decode the resourceId if it's URL-encoded
    const decodedResourceId = decodeURIComponent(resourceId);
    console.log(`Fetching resource ${decodedResourceId} for session ${sessionId}`);
    
    const session = await Session.findById(sessionId);
    if (!session) {
      console.log(`Session ${sessionId} not found`);
      return res.status(404).json({ error: 'Session not found' });
    }

    // Find the resource by its MongoDB _id
    const resource = session.resources.find(r => r._id.toString() === decodedResourceId);
    if (!resource) {
      console.log(`Resource ${decodedResourceId} not found in session ${sessionId}`);
      return res.status(404).json({ error: 'Resource not found' });
    }

    // Set CORS headers for embedded content
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: *; frame-ancestors 'self' *");

    // If resource is stored in S3
    if (resource.s3Key) {
      try {
        console.log(`Fetching resource from S3: ${resource.s3Key}`);
        const file = await s3.getFile(resource.s3Key);
        res.setHeader('Content-Type', resource.contentType);
        res.send(file);
      } catch (error) {
        console.error('Error fetching from S3:', error);
        res.status(500).json({ error: 'Failed to fetch resource from storage' });
      }
    } else {
      // If resource is stored in MongoDB
      res.setHeader('Content-Type', resource.contentType);
      
      // For HTML content, create a proxy page
      if (resource.contentType.includes('text/html')) {
        console.log('Processing HTML content');
        let content = resource.content;
        
        // Replace relative URLs with absolute URLs using our proxy
        content = content.replace(
          /(src|href)=["'](\/[^"']*?)["']/g,
          (match, attr, path) => {
            const absoluteUrl = new URL(path, resource.url).toString();
            const resourceId = session.resources.find(r => r.url === absoluteUrl)?._id;
            if (resourceId) {
              return `${attr}="/api/sessions/${sessionId}/resources/${resourceId}"`;
            }
            return match;
          }
        );

        // Replace absolute URLs with our proxy
        content = content.replace(
          /(src|href)=["'](https?:\/\/[^"']*?)["']/g,
          (match, attr, url) => {
            const resourceId = session.resources.find(r => r.url === url)?._id;
            if (resourceId) {
              return `${attr}="/api/sessions/${sessionId}/resources/${resourceId}"`;
            }
            return match;
          }
        );

        // Remove any existing CSP meta tags from the content
        content = content.replace(
          /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/g,
          ''
        );

        // Add base tag to ensure relative URLs work correctly
        if (!content.includes('<base')) {
          content = content.replace(
            /<head>/i,
            '<head><base href="' + resource.url + '">'
          );
        }

        res.send(content);
      } else if (resource.contentType.includes('text/css')) {
        // For CSS content, ensure URLs are properly handled
        let content = resource.content;
        
        // Replace relative URLs in CSS with absolute URLs
        content = content.replace(
          /url\(['"]?(\/[^'"\)]*?)['"]?\)/g,
          (match, path) => {
            const absoluteUrl = new URL(path, resource.url).toString();
            const resourceId = session.resources.find(r => r.url === absoluteUrl)?._id;
            if (resourceId) {
              return `url("/api/sessions/${sessionId}/resources/${resourceId}")`;
            }
            return match;
          }
        );

        // Replace absolute URLs in CSS with our proxy
        content = content.replace(
          /url\(['"]?(https?:\/\/[^'"\)]*?)['"]?\)/g,
          (match, url) => {
            const resourceId = session.resources.find(r => r.url === url)?._id;
            if (resourceId) {
              return `url("/api/sessions/${sessionId}/resources/${resourceId}")`;
            }
            return match;
          }
        );

        res.send(content);
      } else {
        res.send(resource.content);
      }
    }
  } catch (error) {
    console.error('Error serving resource:', error);
    res.status(500).json({ error: error.message });
  }
});

// Proxy endpoint for both recording and playback
app.get('/proxy/*', async (req, res) => {
  try {
    const targetUrl = req.params[0];
    console.log('Proxying request to:', targetUrl);

    // Decode the URL if it's encoded
    const decodedUrl = decodeURIComponent(targetUrl);
    console.log('Decoded URL:', decodedUrl);

    const response = await fetch(decodedUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      console.error('Proxy request failed:', response.status, response.statusText);
      return res.status(response.status).send(`Failed to fetch resource: ${response.statusText}`);
    }

    // Get the content type from the response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    console.log('Content-Type:', contentType);

    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours

    // Handle different content types
    if (contentType.includes('text/html')) {
      let content = await response.text();
      
      // Replace relative URLs with absolute URLs using our proxy
      content = content.replace(
        /(src|href)=["'](\/[^"']*?)["']/g,
        (match, attr, path) => {
          const absoluteUrl = new URL(path, decodedUrl).toString();
          return `${attr}="http://localhost:5000/proxy/${encodeURIComponent(absoluteUrl)}"`;
        }
      );

      // Replace absolute URLs with our proxy
      content = content.replace(
        /(src|href)=["'](https?:\/\/[^"']*?)["']/g,
        (match, attr, url) => {
          return `${attr}="http://localhost:5000/proxy/${encodeURIComponent(url)}"`;
        }
      );

      // Remove any existing CSP meta tags from the content
      content = content.replace(
        /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/g,
        ''
      );

      // Add base tag to ensure relative URLs work correctly
      if (!content.includes('<base')) {
        content = content.replace(
          /<head>/i,
          '<head><base href="' + decodedUrl + '">'
        );
      }

      res.setHeader('Content-Type', 'text/html');
      res.send(content);
    } else if (contentType.includes('text/css')) {
      let content = await response.text();
      
      // Replace URLs in CSS content
      content = content.replace(
        /url\(['"]?(https?:\/\/[^'"\)]+)['"]?\)/g,
        (match, url) => `url("http://localhost:5000/proxy/${encodeURIComponent(url)}")`
      );

      content = content.replace(
        /url\(['"]?(\/[^'"\)]+)['"]?\)/g,
        (match, path) => {
          const absoluteUrl = new URL(path, decodedUrl).toString();
          return `url("http://localhost:5000/proxy/${encodeURIComponent(absoluteUrl)}")`;
        }
      );

      res.setHeader('Content-Type', 'text/css');
      res.send(content);
    } else {
      // For other content types (including fonts), stream the response
      res.setHeader('Content-Type', contentType);
      response.body.pipe(res);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).send(`Proxy error: ${error.message}`);
  }
});

// Add OPTIONS handler for preflight requests
app.options('/proxy/*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');
  res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
  res.status(204).end();
});

// Start server
async function startServer() {
  try {
    // Initialize MongoDB first
    await initializeMongoDB();
    
    // Initialize S3 (but don't wait for it)
    initializeS3().catch(err => {
      console.error('S3 initialization failed:', err);
    });

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`API available at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();