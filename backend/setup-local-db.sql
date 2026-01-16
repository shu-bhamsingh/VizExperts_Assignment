-- Create local database for development
CREATE DATABASE IF NOT EXISTS chunked_upload;

USE chunked_upload;

-- ====================================================
-- Uploads Table: Main record for each upload session
-- ====================================================
CREATE TABLE IF NOT EXISTS uploads (
    id VARCHAR(36) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    total_size BIGINT UNSIGNED NOT NULL,
    total_chunks INT UNSIGNED NOT NULL,
    status ENUM('UPLOADING', 'PROCESSING', 'COMPLETED', 'FAILED') DEFAULT 'UPLOADING',
    final_hash VARCHAR(64) NULL COMMENT 'SHA-256 hash of complete file',
    file_path VARCHAR(512) NOT NULL COMMENT 'Path to assembled file on disk',
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    completed_at DATETIME NULL,
    
    INDEX idx_status (status),
    INDEX idx_created_at (created_at),
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB;

-- ====================================================
-- Chunks Table: Track individual chunk status
-- Composite primary key ensures idempotency
-- ====================================================
CREATE TABLE IF NOT EXISTS chunks (
    upload_id VARCHAR(36) NOT NULL,
    chunk_index INT UNSIGNED NOT NULL,
    status ENUM('PENDING', 'SUCCESS') DEFAULT 'PENDING',
    received_at DATETIME NULL,
    
    PRIMARY KEY (upload_id, chunk_index),
    FOREIGN KEY (upload_id) REFERENCES uploads(id) ON DELETE CASCADE,
    INDEX idx_upload_status (upload_id, status)
) ENGINE=InnoDB;
