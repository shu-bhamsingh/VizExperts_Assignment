import React, { useState, useRef } from 'react';
import { uploadFile } from './services/uploadService';
import ProgressBar from './components/ProgressBar';
import ChunkGrid from './components/ChunkGrid';
import './App.css';

function App() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [chunkStates, setChunkStates] = useState([]);
  const [metrics, setMetrics] = useState({
    speed: 0,
    eta: 0,
    uploadedSize: 0,
    totalSize: 0
  });
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [uploadId, setUploadId] = useState(null);
  
  const fileInputRef = useRef(null);
  const startTimeRef = useRef(null);
  const uploadedBytesRef = useRef(0);
  const cancelSignalRef = useRef({ cancelled: false });
  
  const handleFileSelect = (event) => {
    const selectedFile = event.target.files[0];
    
    if (!selectedFile) return;
    
    // Validate file type
    if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
      setError('Only ZIP files are supported');
      return;
    }
    
    setFile(selectedFile);
    setError(null);
    setSuccess(false);
    setProgress(0);
    setChunkStates([]);
  };
  
  const calculateMetrics = (uploaded, total) => {
    const currentTime = Date.now();
    const elapsedTime = (currentTime - startTimeRef.current) / 1000; // seconds
    
    if (elapsedTime === 0) return;
    
    const CHUNK_SIZE = 5 * 1024 * 1024;
    const uploadedBytes = uploaded * CHUNK_SIZE;
    uploadedBytesRef.current = uploadedBytes;
    
    const speed = (uploadedBytes / (1024 * 1024)) / elapsedTime; // MB/s
    const remainingBytes = total * CHUNK_SIZE - uploadedBytes;
    const eta = speed > 0 ? remainingBytes / (speed * 1024 * 1024) : 0;
    
    setMetrics({
      speed,
      eta,
      uploadedSize: uploadedBytes,
      totalSize: total * CHUNK_SIZE
    });
  };
  
  const handleUpload = async () => {
    if (!file) return;
    
    setUploading(true);
    setPaused(false);
    setError(null);
    setSuccess(false);
    
    if (!startTimeRef.current) {
      setProgress(0);
      startTimeRef.current = Date.now();
      uploadedBytesRef.current = 0;
    }
    
    // Reset cancel signal
    cancelSignalRef.current = { cancelled: false };
    
    try {
      const result = await uploadFile(file, {
        onProgress: (uploaded, total) => {
          const percentage = Math.round((uploaded / total) * 100);
          setProgress(percentage);
          calculateMetrics(uploaded, total);
        },
        
        onChunkComplete: (chunkIndex, status, states) => {
          setChunkStates([...states]);
        },
        
        onChunkError: (chunkIndex, errorMsg, states) => {
          setChunkStates([...states]);
          console.error(`Chunk ${chunkIndex} error:`, errorMsg);
        },
        
        onComplete: (id) => {
          setSuccess(true);
          setUploadId(id);
          startTimeRef.current = null;
        },
        
        onError: (errorMsg) => {
          setError(errorMsg);
        },
        
        onPause: (id, states) => {
          setUploadId(id);
          setChunkStates([...states]);
          setPaused(true);
          setUploading(false);
        },
        
        cancelSignal: cancelSignalRef.current
      }, uploadId); // Pass uploadId for resume
      
      // Check if paused
      if (result && result.paused) {
        setUploadId(result.uploadId);
        setPaused(true);
      }
      
    } catch (err) {
      setError(err.message);
    } finally {
      if (!cancelSignalRef.current.cancelled) {
        setUploading(false);
      }
    }
  };
  
  const handlePause = () => {
    cancelSignalRef.current.cancelled = true;
    console.log('Pausing upload...');
  };
  
  const handleResume = () => {
    console.log('Resuming upload...');
    handleUpload();
  };
  
  const handleReset = () => {
    cancelSignalRef.current.cancelled = true;
    setFile(null);
    setUploading(false);
    setPaused(false);
    setProgress(0);
    setChunkStates([]);
    setMetrics({
      speed: 0,
      eta: 0,
      uploadedSize: 0,
      totalSize: 0
    });
    setError(null);
    setSuccess(false);
    setUploadId(null);
    startTimeRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1>Chunked Upload System</h1>
          <p className="subtitle">Upload large ZIP files with resumability & fault tolerance</p>
        </header>
        
        <div className="upload-section">
          <div className="file-input-wrapper">
            <input
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              disabled={uploading}
              ref={fileInputRef}
              className="file-input"
              id="file-input"
            />
            <label htmlFor="file-input" className="file-label">
              {file ? file.name : 'Choose ZIP file'}
            </label>
          </div>
          
          {file && (
            <div className="file-info">
              <div className="info-row">
                <span className="info-label">File:</span>
                <span className="info-value">{file.name}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Size:</span>
                <span className="info-value">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Chunks:</span>
                <span className="info-value">
                  {Math.ceil(file.size / (5 * 1024 * 1024))}
                </span>
              </div>
            </div>
          )}
          
          <div className="button-group">
            {!uploading && !paused && (
              <button
                onClick={handleUpload}
                disabled={!file}
                className="button button-primary"
              >
                {uploadId ? 'Resume Upload' : 'Start Upload'}
              </button>
            )}
            
            {uploading && (
              <button
                onClick={handlePause}
                className="button button-warning"
              >
                Pause Upload
              </button>
            )}
            
            {paused && (
              <button
                onClick={handleResume}
                className="button button-success"
              >
              Resume Upload
              </button>
            )}
            
            <button
              onClick={handleReset}
              disabled={uploading}
              className="button button-secondary"
            >
              Reset
            </button>
          </div>
        </div>
        
        {uploading && (
          <>
            <ProgressBar progress={progress} metrics={metrics} />
            <ChunkGrid chunks={chunkStates} />
          </>
        )}
        
        {error && (
          <div className="alert alert-error">
            <span className="alert-icon">❌</span>
            <span>{error}</span>
          </div>
        )}
        
        {success && (
          <div className="alert alert-success">
            <span className="alert-icon">✅</span>
            <div>
              <div>Upload completed successfully!</div>
              <div className="upload-id">Upload ID: {uploadId}</div>
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}

export default App;
