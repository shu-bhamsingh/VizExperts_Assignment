/**
 * Upload Routes
 * Defines API endpoints for chunked upload system
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const uploadController = require('../controllers/uploadController');

const router = express.Router();

// Multer configuration for chunk upload
// Stores chunks temporarily before streaming to final location
const upload = multer({
  dest: process.env.TEMP_DIR || './temp',
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max (safety for 5MB chunks + overhead)
  }
});

/**
 * POST /upload/init
 * Initialize new upload session
 */
router.post('/init', uploadController.initializeUpload);

/**
 * POST /upload/chunk
 * Upload individual chunk
 */
router.post('/chunk', upload.single('chunk'), uploadController.uploadChunk);

/**
 * GET /upload/:id/status
 * Get upload status and progress
 */
router.get('/:id/status', uploadController.getUploadStatus);

/**
 * GET /upload/:id/contents
 * List ZIP file contents
 */
router.get('/:id/contents', uploadController.getZipContents);

module.exports = router;
