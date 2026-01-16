const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [500, 1000, 2000];

async function calculateFileHash(file) {
  const BUFFER_SIZE = 64 * 1024;
  const crypto = window.crypto.subtle;
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    let offset = 0;
    let hashPromise = crypto.digest('SHA-256', new ArrayBuffer(0));
    
    const readNextChunk = () => {
      if (offset >= file.size) {
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
      
      hashPromise = hashPromise.then(async () => {
        return await crypto.digest('SHA-256', chunk);
      });
      
      readNextChunk();
    };
    
    reader.onerror = () => reject(reader.error);
    
    readNextChunk();
  });
}

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

async function calculateChunkHash(chunkBlob) {
  const arrayBuffer = await chunkBlob.arrayBuffer();
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadChunk(uploadId, chunkIndex, chunkBlob, retryCount = 0) {
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
    if (retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAYS[retryCount];
      console.log(`Retrying chunk ${chunkIndex} after ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return uploadChunk(uploadId, chunkIndex, chunkBlob, retryCount + 1);
    }
    
    throw error;
  }
}

async function uploadFile(file, callbacks = {}, resumeUploadId = null) {
  const {
    onProgress = () => {},
    onChunkComplete = () => {},
    onChunkError = () => {},
    onComplete = () => {},
    onError = () => {},
    onPause = () => {},
    cancelSignal = { cancelled: false }
  } = callbacks;
  
  try {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    console.log(`📦 File: ${file.name} (${file.size} bytes, ${totalChunks} chunks)`);
    
    console.log('🔐 Calculating file hash...');
    const fileHash = await calculateFileHash(file);
    console.log(`Hash: ${fileHash.substring(0, 16)}...`);
    
    let uploadId, uploadedChunks;
    
    if (resumeUploadId) {
      console.log('🔄 Resuming upload:', resumeUploadId);
      uploadId = resumeUploadId;
      const response = await fetch(`${API_BASE_URL}/upload/${uploadId}/status`);
      if (response.ok) {
        const status = await response.json();
        uploadedChunks = status.progress?.completed || 0;
        uploadedChunks = Array.from({ length: uploadedChunks }, (_, i) => i);
      } else {
        uploadedChunks = [];
      }
    } else {
      console.log('🚀 Initializing upload...');
      const result = await initializeUpload(file, fileHash);
      uploadId = result.uploadId;
      uploadedChunks = result.uploadedChunks;
    }
    
    console.log(`Upload ID: ${uploadId}`);
    console.log(`Already uploaded: ${uploadedChunks.length} chunks`);
    
    const uploadedSet = new Set(uploadedChunks);
    const chunkQueue = [];
    
    for (let i = 0; i < totalChunks; i++) {
      if (!uploadedSet.has(i)) {
        chunkQueue.push(i);
      }
    }
    
    console.log(`📋 Chunks to upload: ${chunkQueue.length}/${totalChunks}`);
    
    const chunkStates = new Array(totalChunks).fill('pending');
    uploadedChunks.forEach(index => {
      chunkStates[index] = 'success';
    });
    
    let uploadedCount = uploadedChunks.length;
    let queueIndex = 0;
    const activeUploads = new Set();
    
    const uploadNextChunk = async () => {
      if (cancelSignal.cancelled) {
        console.log('⏸️ Upload paused');
        onPause(uploadId, chunkStates);
        return;
      }
      
      if (queueIndex >= chunkQueue.length) {
        return;
      }
      
      const chunkIndex = chunkQueue[queueIndex++];
      activeUploads.add(chunkIndex);
      
      chunkStates[chunkIndex] = 'uploading';
      onChunkComplete(chunkIndex, 'uploading', chunkStates);
      
      try {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);
        
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
        
        if (queueIndex < chunkQueue.length && !cancelSignal.cancelled) {
          await uploadNextChunk();
        }
      }
    };
    
    const initialBatch = Math.min(MAX_CONCURRENT_UPLOADS, chunkQueue.length);
    await Promise.all(
      Array(initialBatch).fill(null).map(() => uploadNextChunk())
    );
    
    while (activeUploads.size > 0 && !cancelSignal.cancelled) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (cancelSignal.cancelled) {
      console.log('⏸️ Upload paused at', uploadedCount, '/', totalChunks);
      return { uploadId, paused: true, progress: uploadedCount };
    }
    
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
