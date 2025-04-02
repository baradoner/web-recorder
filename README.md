# Web Recorder

A web application for recording browsing sessions and replaying them later.

## Features

- Record web browsing sessions
- View recorded sessions
- Proxy handling for cross-origin resources
- Support for HTML, CSS, and other file types
- Automatic handling for Content Security Policy restrictions
- MongoDB storage for session data
- AWS S3 integration for large files (optional)

## Setup

### Prerequisites

- Node.js (v14 or higher)
- MongoDB
- (Optional) AWS S3 account for storing large files

### Installation

1. Clone the repository
```
git clone https://github.com/baradon/web-recorder.git
cd web-recorder
```

2. Install dependencies
```
npm install
cd src/client
npm install
cd ../..
```

3. Create a `.env` file in the root directory with the following variables:
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/webrecorder

# Optional S3 configuration
AWS_REGION=your-region
AWS_S3_BUCKET=your-bucket
AWS_ACCESS_KEY_ID=your-key-id
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### Running the Application

1. Start the server
```
npm start
```

2. Start the client in development mode
```
cd src/client
npm run dev
```

3. Access the application at `http://localhost:3000`

## Usage

1. Enter a URL to record a browsing session
2. Click "Start Recording"
3. Browse the website
4. Click "Stop Recording" when finished
5. View your recorded sessions in the list
6. Click on a session to replay it

## Technical Details

The application consists of:
- Express.js backend
- React frontend
- Puppeteer for web recording
- MongoDB for data storage
- AWS S3 for large file storage (optional)

## License

MIT 