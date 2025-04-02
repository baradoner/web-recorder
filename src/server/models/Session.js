const mongoose = require('mongoose');

const resourceSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  status: {
    type: Number,
    required: true
  },
  contentType: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    required: true
  },
  content: {
    type: String,
    default: null
  },
  s3Key: {
    type: String,
    default: null
  }
});

const sessionSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  timestamp: {
    type: Number,
    required: true
  },
  startTime: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['recording', 'completed'],
    default: 'recording'
  },
  resources: [resourceSchema]
}, {
  timestamps: true
});

// Delete the model if it exists to prevent the "Cannot overwrite model" error
if (mongoose.models.Session) {
  delete mongoose.models.Session;
}

module.exports = mongoose.model('Session', sessionSchema); 