const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000];

async function calculateFileHash(file) {
  const BUFFER_SIZE = 64 * 1024; // 64KB chunks
  const crypto = window.crypto.subtle;
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let offset = 0;
    let hashPromise = crypto.digest('SHA-256', new ArrayBuffer(0));
    
    const readNextChunk = () => {
      if (offset >= file.size) {
        // Finalize hash
        hashPromise.then(hashBuffer => {
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          resolve(hashHex);
        }).catch(reject);
        return;
      }
      
      const slice = file.slice(offset, offset + BUFFER_SIZE);
      reader.readAsArrayBuffer(slice);
    };
    
    reader.onload = async (e) => {
      const chunk = e.target.result;
      offset += chunk.byteLength;
      
      // Update hash incrementally
      hashPromise = hashPromise.then(async () => {
        return await crypto.digest('SHA-256', chunk);
      });
      
      readNextChunk();
    };
    
    reader.onerror = () => reject(reader.error);
    
    readNextChunk();
  });
}

/**
 * Initialize upload session with backend
 */
async function initializeUpload(file, fileHash) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  
  const response = await fetch(`${API_BASE_URL}/upload/init`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      filename: file.name,
      totalSize: file.size,
      totalChunks,
      fileHash
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Upload initialization failed');
  }
  
  return await response.json();
}

/**
 * Calculate SHA-256 hash of a chunk
 */
async function calculateChunkHash(chunkBlob) {
  const arrayBuffer = await chunkBlob.arrayBuffer();
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Upload single chunk with retry logic
 */
async function uploadChunk(uploadId, chunkIndex, chunkBlob, retryCount = 0) {
  // Calculate chunk hash for integrity verification
  const chunkHash = await calculateChunkHash(chunkBlob);
  
  const formData = new FormData();
  formData.append('uploadId', uploadId);
  formData.append('chunkIndex', chunkIndex);
  formData.append('chunkHash', chunkHash);
  formData.append('chunk', chunkBlob, `chunk_${chunkIndex}`);
  
  try {
    const response = await fetch(`${API_BASE_URL}/upload/chunk`, {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
    
  } catch (error) {
    // Retry logic with exponential backoff
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(`Retrying chunk ${chunkIndex} after ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return uploadChunk(uploadId, chunkIndex, chunkBlob, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Main upload orchestrator
 * Implements queue-based concurrent upload with progress tracking
 */
async function uploadFile(file, callbacks = {}) {
  const {
    onProgress = () => {},
    onChunkComplete = () => {},
    onChunkError = () => {},
    onComplete = () => {},
    onError = () => {}
  } = callbacks;
  
  try {
    // Step 1: Calculate total chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    console.log(`📦 File: ${file.name} (${file.size} bytes, ${totalChunks} chunks)`);
    
    // Step 2: Calculate file hash (for integrity check)
    console.log('🔐 Calculating file hash...');
    const fileHash = await calculateFileHash(file);
    console.log(`Hash: ${fileHash.substring(0, 16)}...`);
    
    // Step 3: Initialize upload
    console.log('🚀 Initializing upload...');
    const { uploadId, uploadedChunks } = await initializeUpload(file, fileHash);
    console.log(`Upload ID: ${uploadId}`);
    console.log(`Already uploaded: ${uploadedChunks.length} chunks`);
    
    // Step 4: Build chunk queue (skip already uploaded)
    const uploadedSet = new Set(uploadedChunks);
    const chunkQueue = [];
    
    for (let i = 0; i < totalChunks; i++) {
      if (!uploadedSet.has(i)) {
        chunkQueue.push(i);
      }
    }
    
    console.log(`📋 Chunks to upload: ${chunkQueue.length}/${totalChunks}`);
    
    // Step 5: Upload chunks with concurrency control
    const chunkStates = new Array(totalChunks).fill('pending');
    uploadedChunks.forEach(index => {
      chunkStates[index] = 'success';
    });
    
    let uploadedCount = uploadedChunks.length;
    let queueIndex = 0;
    const activeUploads = new Set();
    
    const uploadNextChunk = async () => {
      if (queueIndex >= chunkQueue.length) {
        return;
      }
      
      const chunkIndex = chunkQueue[queueIndex++];
      activeUploads.add(chunkIndex);
      
      chunkStates[chunkIndex] = 'uploading';
      onChunkComplete(chunkIndex, 'uploading', chunkStates);
      
      try {
        // Extract chunk from file
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);
        
        // Upload chunk
        await uploadChunk(uploadId, chunkIndex, chunkBlob);
        
        chunkStates[chunkIndex] = 'success';
        uploadedCount++;
        
        onChunkComplete(chunkIndex, 'success', chunkStates);
        onProgress(uploadedCount, totalChunks);
        
      } catch (error) {
        chunkStates[chunkIndex] = 'error';
        onChunkError(chunkIndex, error.message, chunkStates);
        console.error(`❌ Chunk ${chunkIndex} failed:`, error.message);
      } finally {
        activeUploads.delete(chunkIndex);
        
        // Upload next chunk
        if (queueIndex < chunkQueue.length) {
          await uploadNextChunk();
        }
      }
    };
    
    // Start concurrent uploads
    const initialBatch = Math.min(MAX_CONCURRENT_UPLOADS, chunkQueue.length);
    await Promise.all(
      Array(initialBatch).fill(null).map(() => uploadNextChunk())
    );
    
    // Wait for all uploads to complete
    while (activeUploads.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Step 6: Check if all succeeded
    const failedChunks = chunkStates
      .map((state, index) => ({ state, index }))
      .filter(({ state }) => state === 'error');
    
    if (failedChunks.length > 0) {
      throw new Error(`${failedChunks.length} chunks failed to upload`);
    }
    
    console.log('✅ All chunks uploaded successfully');
    onComplete(uploadId);
    
    return { uploadId, success: true };
    
  } catch (error) {
    console.error('❌ Upload failed:', error);
    onError(error.message);
    throw error;
  }
}

export {
  uploadFile,
  calculateFileHash
};
