/**
 * Database initialization script
 * Reads schema.sql and creates tables
 */

const fs = require('fs').promises;
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config();

async function initDatabase() {
  let connection;
  
  try {
    console.log('🔌 Connecting to MySQL...');
    
    // First connect without database to create it
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'rootpassword',
      multipleStatements: true
    });
    
    console.log('✅ Connected to MySQL');
    
    // Create database if it doesn't exist
    const dbName = process.env.DB_NAME || 'chunked_upload';
    console.log(`📦 Creating database '${dbName}' if not exists...`);
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${dbName}`);
    await connection.query(`USE ${dbName}`);
    console.log(`✅ Using database '${dbName}'`);
    
    // Read and execute schema (skip USE statement)
    const schemaPath = path.join(__dirname, '../../schema.sql');
    let schema = await fs.readFile(schemaPath, 'utf8');
    
    // Remove the USE statement from schema since we already selected the database
    schema = schema.replace(/USE\s+[^;]+;/gi, '');
    
    console.log('📝 Executing schema...');
    await connection.query(schema);
    
    console.log('✅ Database initialized successfully');
    console.log('📊 Tables created: uploads, chunks');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

initDatabase();
