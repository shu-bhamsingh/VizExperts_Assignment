const express = require('express');
const multer = require('multer');
const path = require('path');
const uploadController = require('../controllers/uploadController');

const router = express.Router();

const upload = multer({
  dest: process.env.TEMP_DIR || './temp',
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

router.post('/init', uploadController.initializeUpload);

router.post('/chunk', upload.single('chunk'), uploadController.uploadChunk);

router.get('/:id/status', uploadController.getUploadStatus);

router.get('/:id/contents', uploadController.getZipContents);

module.exports = router;
