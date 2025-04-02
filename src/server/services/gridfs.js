const { GridFSBucket } = require('mongodb');
const mongoose = require('mongoose');

class GridFSService {
  constructor() {
    this.bucket = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    // Wait for mongoose connection
    if (mongoose.connection.readyState !== 1) {
      await new Promise((resolve) => {
        mongoose.connection.once('connected', resolve);
      });
    }

    this.bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'resources'
    });
    this.initialized = true;
  }

  async uploadFile(buffer, filename, contentType) {
    await this.initialize();
    const uploadStream = this.bucket.openUploadStream(filename, {
      contentType,
      metadata: { timestamp: Date.now() }
    });

    return new Promise((resolve, reject) => {
      uploadStream.end(buffer);
      uploadStream.on('finish', () => resolve(uploadStream.id));
      uploadStream.on('error', reject);
    });
  }

  async getFile(fileId) {
    await this.initialize();
    return this.bucket.openDownloadStream(fileId);
  }

  async deleteFile(fileId) {
    await this.initialize();
    return this.bucket.delete(fileId);
  }
}

module.exports = new GridFSService(); 