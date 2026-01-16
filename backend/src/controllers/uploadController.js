const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('../config/database');
const fileUtils = require('../utils/fileUtils');
const hashUtils = require('../utils/hashUtils');
const zipUtils = require('../utils/zipUtils');
const chunkHashUtils = require('../utils/chunkHashUtils');

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 5242880;

async function initializeUpload(req, res) {
  const { filename, totalSize, totalChunks, fileHash } = req.body;
  
  // console.log('Init upload:', { filename, totalSize, totalChunks });
  
  if (!filename || !totalSize || !totalChunks) {
    return res.status(400).json({
      error: 'Missing required fields: filename, totalSize, totalChunks'
    });
  }
  
  if (totalSize <= 0 || totalChunks <= 0) {
    return res.status(400).json({
      error: 'Invalid totalSize or totalChunks'
    });
  }
  
  // Check if file is ZIP
  if (!filename.toLowerCase().endsWith('.zip')) {
    return res.status(400).json({
      error: 'Only ZIP files are supported'
    });
  }
  
  let connection;
  
  try {
    const uploadId = uuidv4();
    const filePath = path.join(UPLOAD_DIR, `${uploadId}.zip`);
    
    await fileUtils.ensureDirectory(UPLOAD_DIR);
    
    console.log(`Pre-allocating ${totalSize} bytes for ${filename}`);
    await fileUtils.preallocateFile(filePath, totalSize);
    
    // Start transaction
    connection = await db.getConnection();
    await connection.beginTransaction();
    
    // Insert upload record
    await connection.query(
      `INSERT INTO uploads (id, filename, total_size, total_chunks, status, file_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'UPLOADING', ?, NOW(), NOW())`,
      [uploadId, filename, totalSize, totalChunks, filePath]
    );
    
    // Pre-create all chunk records as PENDING
    const chunkRecords = [];
    for (let i = 0; i < totalChunks; i++) {
      chunkRecords.push([uploadId, i, 'PENDING']);
    }
    
    await connection.query(
      `INSERT INTO chunks (upload_id, chunk_index, status) VALUES ?`,
      [chunkRecords]
    );
    
    await connection.commit();
    
    // Query uploaded chunks (in case of resume)
    const [uploadedChunks] = await connection.query(
      `SELECT chunk_index FROM chunks WHERE upload_id = ? AND status = 'SUCCESS'`,
      [uploadId]
    );
    
    const uploadedIndices = uploadedChunks.map(row => row.chunk_index);
    
    console.log(`Upload initialized: ${uploadId} (${uploadedIndices.length}/${totalChunks} chunks ready)`);
    
    res.json({
      uploadId,
      uploadedChunks: uploadedIndices,
      message: 'Upload initialized successfully'
    });
    
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Upload initialization failed:', error);
    res.status(500).json({
      error: 'Upload initialization failed',
      details: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function uploadChunk(req, res) {
  const { uploadId, chunkIndex, chunkHash } = req.body;
  const chunkData = req.file;
  
  // Validation
  if (!uploadId || chunkIndex === undefined || !chunkData) {
    return res.status(400).json({
      error: 'Missing required fields: uploadId, chunkIndex, or chunk data'
    });
  }
  
  const chunkIndexNum = parseInt(chunkIndex);
  
  let connection;
  
  try {
    connection = await db.getConnection();
    
    // Verify chunk hash if provided (integrity check)
    if (chunkHash) {
      const chunkBuffer = require('fs').readFileSync(chunkData.path);
      const isValid = chunkHashUtils.verifyChunkHash(chunkBuffer, chunkHash);
      
      if (!isValid) {
        await fileUtils.safeDeleteFile(chunkData.path);
        return res.status(400).json({
          error: 'Chunk hash verification failed',
          chunkIndex: chunkIndexNum
        });
      }
      
      console.log(`✓ Chunk ${chunkIndexNum} hash verified`);
    }
    
    // Fetch upload details
    const [uploads] = await connection.query(
      `SELECT id, file_path, total_chunks, total_size, status FROM uploads WHERE id = ?`,
      [uploadId]
    );
    
    if (uploads.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    const upload = uploads[0];
    
    if (upload.status !== 'UPLOADING') {
      return res.status(400).json({
        error: `Upload is in ${upload.status} state, cannot accept chunks`
      });
    }
    
    if (chunkIndexNum < 0 || chunkIndexNum >= upload.total_chunks) {
      return res.status(400).json({
        error: `Invalid chunk index: ${chunkIndexNum}`
      });
    }
    
    const [chunks] = await connection.query(
      `SELECT status FROM chunks WHERE upload_id = ? AND chunk_index = ?`,
      [uploadId, chunkIndexNum]
    );
    
    if (chunks.length > 0 && chunks[0].status === 'SUCCESS') {
      console.log(`Chunk ${chunkIndexNum} already uploaded, skipping`);
      return res.json({
        message: 'Chunk already uploaded',
        chunkIndex: chunkIndexNum,
        duplicate: true
      });
    }
    
    const offset = chunkIndexNum * CHUNK_SIZE;
    
    const chunkStream = require('fs').createReadStream(chunkData.path);
    await fileUtils.writeChunkAtOffset(upload.file_path, offset, chunkStream);
    
    await fileUtils.safeDeleteFile(chunkData.path);
    
    await connection.query(
      `UPDATE chunks SET status = 'SUCCESS', received_at = NOW()
       WHERE upload_id = ? AND chunk_index = ?`,
      [uploadId, chunkIndexNum]
    );
    
    const [chunkStatus] = await connection.query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as completed
       FROM chunks WHERE upload_id = ?`,
      [uploadId]
    );
    
    const { total, completed } = chunkStatus[0];
    const isComplete = completed === total;
    
    console.log(`Chunk ${chunkIndexNum} uploaded (${completed}/${total})`);
    
    if (isComplete) {
      setTimeout(() => finalizeUpload(uploadId), 0);
    }
    
    res.json({
      message: 'Chunk uploaded successfully',
      chunkIndex: chunkIndexNum,
      progress: {
        completed,
        total,
        isComplete
      }
    });
    
  } catch (error) {
    console.error(`Chunk upload failed (${chunkIndex}):`, error);
    
    // Clean up temp file on error
    if (chunkData && chunkData.path) {
      await fileUtils.safeDeleteFile(chunkData.path);
    }
    
    res.status(500).json({
      error: 'Chunk upload failed',
      details: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function finalizeUpload(uploadId) {
  let connection;
  
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    
    // CRITICAL: Lock row with FOR UPDATE to prevent double finalization
    const [uploads] = await connection.query(
      `SELECT id, file_path, total_size, status, final_hash FROM uploads
       WHERE id = ? FOR UPDATE`,
      [uploadId]
    );
    
    if (uploads.length === 0) {
      console.error(`Upload ${uploadId} not found during finalization`);
      await connection.rollback();
      return;
    }
    
    const upload = uploads[0];
    
    if (upload.status !== 'UPLOADING') {
      console.log(`Upload ${uploadId} already finalized (status: ${upload.status})`);
      await connection.rollback();
      return;
    }
    
    // Update status to PROCESSING (prevents concurrent finalization)
    await connection.query(
      `UPDATE uploads SET status = 'PROCESSING', updated_at = NOW()
       WHERE id = ?`,
      [uploadId]
    );
    
    await connection.commit();
    
    console.log(`Finalizing upload ${uploadId}...`);
    
    const actualSize = await fileUtils.getFileSize(upload.file_path);
    if (actualSize !== upload.total_size) {
      throw new Error(`File size mismatch: expected ${upload.total_size}, got ${actualSize}`);
    }
    
    console.log(`Calculating SHA-256 hash...`);
    const finalHash = await hashUtils.calculateFileHash(upload.file_path);
    
    // Verify ZIP validity
    const isValid = await zipUtils.isValidZip(upload.file_path);
    if (!isValid) {
      throw new Error('Invalid ZIP file');
    }
    
    // Mark as COMPLETED
    await db.query(
      `UPDATE uploads SET status = 'COMPLETED', final_hash = ?, completed_at = NOW()
       WHERE id = ?`,
      [finalHash, uploadId]
    );
    
    console.log(`Upload ${uploadId} finalized successfully (hash: ${finalHash.substring(0, 16)}...)`);
    
  } catch (error) {
    console.error(`Finalization failed for ${uploadId}:`, error);
    
    // Mark as FAILED
    if (connection) {
      await connection.query(
        `UPDATE uploads SET status = 'FAILED' WHERE id = ?`,
        [uploadId]
      );
    }
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

async function getUploadStatus(req, res) {
  const { id } = req.params;
  
  try {
    const [uploads] = await db.query(
      `SELECT id, filename, total_size, total_chunks, status, final_hash, created_at, completed_at
       FROM uploads WHERE id = ?`,
      [id]
    );
    
    if (uploads.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    const upload = uploads[0];
    
    // Get chunk status
    const [chunkStatus] = await db.query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as completed
       FROM chunks WHERE upload_id = ?`,
      [id]
    );
    
    const { total, completed } = chunkStatus[0];
    
    res.json({
      upload,
      progress: {
        completed,
        total,
        percentage: Math.round((completed / total) * 100)
      }
    });
    
  } catch (error) {
    console.error('Status fetch failed:', error);
    res.status(500).json({
      error: 'Failed to fetch upload status',
      details: error.message
    });
  }
}

async function getZipContents(req, res) {
  const { id } = req.params;
  
  try {
    const [uploads] = await db.query(
      `SELECT file_path, status FROM uploads WHERE id = ?`,
      [id]
    );
    
    if (uploads.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    
    const upload = uploads[0];
    
    if (upload.status !== 'COMPLETED') {
      return res.status(400).json({
        error: `Upload not completed (status: ${upload.status})`
      });
    }
    
    // List ZIP contents using streaming
    const contents = await zipUtils.listZipContents(upload.file_path);
    
    res.json({
      uploadId: id,
      fileCount: contents.length,
      contents
    });
    
  } catch (error) {
    console.error('ZIP listing failed:', error);
    res.status(500).json({
      error: 'Failed to list ZIP contents',
      details: error.message
    });
  }
}

module.exports = {
  initializeUpload,
  uploadChunk,
  getUploadStatus,
  getZipContents
};
