const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class S3Service {
  constructor() {
    this.client = null;
    this.bucket = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    // Validate environment variables
    if (!process.env.AWS_REGION) {
      throw new Error('AWS_REGION is required');
    }
    if (!process.env.AWS_ACCESS_KEY_ID) {
      throw new Error('AWS_ACCESS_KEY_ID is required');
    }
    if (!process.env.AWS_SECRET_ACCESS_KEY) {
      throw new Error('AWS_SECRET_ACCESS_KEY is required');
    }
    if (!process.env.AWS_S3_BUCKET) {
      throw new Error('AWS_S3_BUCKET is required');
    }

    this.bucket = process.env.AWS_S3_BUCKET;
    console.log('Initializing S3 service with bucket:', this.bucket);

    this.client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });

    // Test the connection
    try {
      await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: 'test.txt'
      }));
    } catch (error) {
      if (error.name !== 'NoSuchKey') {
        console.error('Error testing S3 connection:', error);
        throw error;
      }
    }

    this.initialized = true;
  }

  async uploadFile(buffer, key, contentType) {
    await this.initialize();

    if (!this.bucket) {
      throw new Error('S3 bucket name is not configured');
    }

    console.log('Uploading file to S3:', {
      bucket: this.bucket,
      key: key,
      contentType: contentType,
      bufferSize: buffer.length
    });

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      Metadata: {
        timestamp: Date.now().toString()
      }
    });

    try {
      await this.client.send(command);
      console.log('Successfully uploaded file to S3:', key);
      return key;
    } catch (error) {
      console.error('Error uploading to S3:', error);
      throw error;
    }
  }

  async getFile(key) {
    await this.initialize();

    if (!this.bucket) {
      throw new Error('S3 bucket name is not configured');
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    try {
      // Generate a signed URL that expires in 1 hour
      const signedUrl = await getSignedUrl(this.client, command, { expiresIn: 3600 });
      return signedUrl;
    } catch (error) {
      console.error('Error getting file from S3:', error);
      throw error;
    }
  }

  async deleteFile(key) {
    await this.initialize();

    if (!this.bucket) {
      throw new Error('S3 bucket name is not configured');
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key
    });

    try {
      await this.client.send(command);
    } catch (error) {
      console.error('Error deleting file from S3:', error);
      throw error;
    }
  }
}

module.exports = new S3Service(); 