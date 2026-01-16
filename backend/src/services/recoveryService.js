const db = require('../config/database');
const fileUtils = require('../utils/fileUtils');
const hashUtils = require('../utils/hashUtils');
const zipUtils = require('../utils/zipUtils');

/**
 * Recovery Service - Handles server crash recovery
 * 
 * On server startup, this service:
 * 1. Finds uploads stuck in PROCESSING state (interrupted finalization)
 * 2. Resumes finalization for complete uploads
 * 3. Resets incomplete uploads back to UPLOADING state
 */

async function recoverInterruptedUploads() {
  try {
    console.log('🔄 Starting recovery service...');
    
    // Find uploads stuck in PROCESSING state
    const [processingUploads] = await db.query(
      `SELECT id, file_path, total_size, total_chunks, filename
       FROM uploads
       WHERE status = 'PROCESSING'`
    );
    
    if (processingUploads.length === 0) {
      console.log('✅ No interrupted uploads found');
      return;
    }
    
    console.log(`Found ${processingUploads.length} interrupted upload(s)`);
    
    for (const upload of processingUploads) {
      try {
        await recoverSingleUpload(upload);
      } catch (error) {
        console.error(`❌ Failed to recover upload ${upload.id}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Recovery service failed:', error);
  }
}

async function recoverSingleUpload(upload) {
  console.log(`Recovering upload: ${upload.filename} (${upload.id})`);
  
  // Check if file exists
  const fileExists = await fileUtils.fileExists(upload.file_path);
  if (!fileExists) {
    console.log(`File not found, marking as FAILED: ${upload.id}`);
    await db.query(
      `UPDATE uploads SET status = 'FAILED' WHERE id = ?`,
      [upload.id]
    );
    return;
  }
  
  // Check if all chunks are received
  const [chunkStatus] = await db.query(
    `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as completed
     FROM chunks WHERE upload_id = ?`,
    [upload.id]
  );
  
  const { total, completed } = chunkStatus[0];
  
  if (completed < total) {
    // Not all chunks received, reset to UPLOADING
    console.log(`Incomplete upload (${completed}/${total} chunks), resetting to UPLOADING`);
    await db.query(
      `UPDATE uploads SET status = 'UPLOADING', updated_at = NOW()
       WHERE id = ?`,
      [upload.id]
    );
    return;
  }
  
  // All chunks received, resume finalization
  console.log(`All chunks present (${completed}/${total}), resuming finalization...`);
  
  try {
    // Validate file size
    const actualSize = await fileUtils.getFileSize(upload.file_path);
    if (actualSize !== upload.total_size) {
      throw new Error(`File size mismatch: expected ${upload.total_size}, got ${actualSize}`);
    }
    
    // Calculate SHA-256 hash
    console.log(`Calculating SHA-256 hash for ${upload.id}...`);
    const finalHash = await hashUtils.calculateFileHash(upload.file_path);
    
    // Verify ZIP validity
    console.log(`Validating ZIP structure...`);
    const isValid = await zipUtils.isValidZip(upload.file_path);
    if (!isValid) {
      throw new Error('Invalid ZIP file');
    }
    
    // Mark as COMPLETED
    await db.query(
      `UPDATE uploads SET status = 'COMPLETED', final_hash = ?, completed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [finalHash, upload.id]
    );
    
    console.log(`✅ Upload ${upload.id} recovered successfully (hash: ${finalHash.substring(0, 16)}...)`);
    
  } catch (error) {
    console.error(`Finalization failed for ${upload.id}:`, error.message);
    
    // Mark as FAILED
    await db.query(
      `UPDATE uploads SET status = 'FAILED', updated_at = NOW()
       WHERE id = ?`,
      [upload.id]
    );
  }
}

/**
 * Find and cleanup stale UPLOADING uploads (abandoned)
 */
async function recoverAbandonedUploads() {
  try {
    const ABANDONED_TIMEOUT_HOURS = parseInt(process.env.ABANDONED_UPLOAD_TIMEOUT) / 3600000 || 24;
    
    const [abandonedUploads] = await db.query(
      `SELECT id, file_path, filename FROM uploads
       WHERE status = 'UPLOADING'
       AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
      [ABANDONED_TIMEOUT_HOURS]
    );
    
    if (abandonedUploads.length === 0) {
      return;
    }
    
    console.log(`Found ${abandonedUploads.length} abandoned upload(s) to cleanup`);
    
    for (const upload of abandonedUploads) {
      try {
        await fileUtils.safeDeleteFile(upload.file_path);
        await db.query(
          `UPDATE uploads SET status = 'FAILED', updated_at = NOW() WHERE id = ?`,
          [upload.id]
        );
        console.log(`✅ Cleaned up abandoned upload: ${upload.filename}`);
      } catch (error) {
        console.error(`❌ Failed to cleanup ${upload.id}:`, error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Abandoned upload recovery failed:', error);
  }
}

/**
 * Full recovery process on server startup
 */
async function performStartupRecovery() {
  console.log('\n==========================================');
  console.log('🚀 CRASH RECOVERY SERVICE');
  console.log('==========================================\n');
  
  await recoverInterruptedUploads();
  await recoverAbandonedUploads();
  
  console.log('\n==========================================');
  console.log('✅ RECOVERY COMPLETE');
  console.log('==========================================\n');
}

module.exports = {
  performStartupRecovery,
  recoverInterruptedUploads,
  recoverAbandonedUploads
};
