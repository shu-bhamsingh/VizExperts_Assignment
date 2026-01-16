const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const uploadRoutes = require('./routes/uploadRoutes');
const cleanupService = require('./services/cleanupService');
const recoveryService = require('./services/recoveryService');
const fileUtils = require('./utils/fileUtils');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  // console.log('Body:', req.body); // uncomment for debugging
  next();
});

// Routes
app.use('/upload', uploadRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found'
  });
});

// Initialize server
async function startServer() {
  try {
    // Ensure directories exist
    const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
    const TEMP_DIR = process.env.TEMP_DIR || './temp';
    
    await fileUtils.ensureDirectory(UPLOAD_DIR);
    await fileUtils.ensureDirectory(TEMP_DIR);
    
    console.log('Directories initialized');
    
    // Run crash recovery on startup
    await recoveryService.performStartupRecovery();
    
    // Start cleanup service for abandoned uploads
    cleanupService.startCleanupService();
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
    
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  process.exit(0);
});

startServer();
