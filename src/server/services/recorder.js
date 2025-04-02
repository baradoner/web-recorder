const puppeteer = require('puppeteer');
const Session = require('../models/Session');
const mime = require('mime-types');
const s3 = require('./s3');
const zlib = require('zlib');
const path = require('path');

class Recorder {
  constructor() {
    this.browser = null;
    this.page = null;
    this.sessionId = null;
    this.isRecording = false;
    this.requests = new Map();
    this.MAX_DOC_SIZE = 15 * 1024 * 1024; // 15MB (leaving some headroom)
    this.startTime = null;
    this.resources = new Map();
  }

  // Validate and format URL
  formatUrl(url) {
    try {
      // Remove any whitespace
      url = url.trim();

      // Add protocol if missing
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      // Validate URL
      new URL(url);
      return url;
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  }

  async startRecording(url, sessionId) {
    this.sessionId = sessionId;
    this.isRecording = true;

    try {
      // Format and validate URL
      const formattedUrl = this.formatUrl(url);

      this.browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
      });

      this.page = await this.browser.newPage();
      
      // Enable request interception
      await this.page.setRequestInterception(true);
      this.page.on('request', this.handleRequest.bind(this));
      this.page.on('response', this.handleResponse.bind(this));

      // Set longer timeout and more lenient navigation options
      console.log('Navigating to URL:', formattedUrl);
      await this.page.goto(formattedUrl, {
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: 60000, // Increase timeout to 60 seconds
        waitForTimeout: 5000 // Wait an additional 5 seconds after load
      });

      // Ensure we capture the main HTML content
      const mainContent = await this.page.content();
      const resource = {
        url: formattedUrl,
        status: 200,
        contentType: 'text/html',
        timestamp: new Date(),
        content: mainContent
      };

      this.startTime = Date.now();
      
      // Create initial session record with the main HTML content
      await Session.create({
        _id: this.sessionId,
        url: formattedUrl,
        status: 'recording',
        startTime: this.startTime,
        timestamp: this.startTime,
        resources: [resource]
      });

      return true;
    } catch (error) {
      console.error('Error starting recording:', error);
      // Clean up browser if it exists
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
      throw new Error(`Failed to start recording: ${error.message}`);
    }
  }

  async stopRecording(sessionId) {
    // Verify this is the active recording session
    if (this.sessionId !== sessionId) {
      console.error('Session ID mismatch:', { current: this.sessionId, requested: sessionId });
      return null;
    }

    this.isRecording = false;
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }

    // Update session status to completed
    const session = await Session.findByIdAndUpdate(
      this.sessionId,
      { status: 'completed' },
      { new: true }
    );

    // Clear the session ID after stopping
    this.sessionId = null;

    return session;
  }

  async handleRequest(request) {
    const requestId = request.url();
    this.requests.set(requestId, {
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      timestamp: Date.now()
    });

    try {
      await request.continue();
    } catch (error) {
      console.error('Error handling request:', error);
      await request.continue();
    }
  }

  async handleResponse(response) {
    if (!this.isRecording) return;

    try {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] || 'application/octet-stream';
      const contentLength = parseInt(response.headers()['content-length'] || '0', 10);
      const isLargeFile = contentLength > 5 * 1024 * 1024; // 5MB threshold

      // Skip if it's a redirect or preflight request
      if (status >= 300 && status < 400) {
        return;
      }

      // Skip preflight requests
      if (response.request().method() === 'OPTIONS') {
        return;
      }

      let content;
      let s3Key = null;

      try {
        // Always capture the main HTML content
        if (url === this.page.url() && contentType.includes('text/html')) {
          console.log('Capturing main HTML content:', url);
          content = await response.text();
        } else if (isLargeFile) {
          // For large files, stream directly to S3
          const buffer = await response.buffer();
          const key = `sessions/${this.sessionId}/resources/${Date.now()}-${url.split('/').pop()}`;
          await s3.uploadFile(key, buffer, contentType);
          s3Key = key;
        } else {
          // For small files, store in MongoDB
          content = await response.text();
        }
      } catch (error) {
        if (error.message.includes('Request content was evicted')) {
          console.log('Content was evicted from cache, skipping:', url);
          return;
        }
        throw error;
      }

      // Create resource record
      const resource = {
        url,
        status,
        contentType,
        timestamp: new Date(),
        content: content || null,
        s3Key: s3Key || null
      };

      // Update session with new resource
      await Session.findByIdAndUpdate(
        this.sessionId,
        {
          $push: { resources: resource },
          $set: { status: 'recording' }
        },
        { new: true }
      );

      // If this is a CSS resource, ensure it's properly captured
      if (contentType.includes('text/css') || url.endsWith('.css')) {
        console.log('Captured CSS resource:', url);
      }
    } catch (error) {
      // Only log errors that aren't related to preflight requests or evicted content
      if (!error.message.includes('preflight') && !error.message.includes('Request content was evicted')) {
        console.error('Error saving response:', error);
      }
    }
  }
}

module.exports = new Recorder();