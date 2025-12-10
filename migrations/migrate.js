#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const sslRequired = connectionString && connectionString.includes('sslmode=require');

// Database configuration - same as working test script
const dbConfig = connectionString
    ? {
          connectionString,
          ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {}),
      }
    : {
          user: process.env.DB_USER || 'postgres',
          host: process.env.DB_HOST || 'localhost',
          database: process.env.DB_NAME || 'easy_post',
          password: process.env.DB_PASSWORD || 'password',
          port: parseInt(process.env.DB_PORT, 10) || 5432,
      };

const logDbConfig = () => {
    if (dbConfig.connectionString) {
        try {
            const url = new URL(dbConfig.connectionString);

            console.log('Database config:', {
                host: url.hostname,
                user: url.username ? '***SET***' : 'NOT SET',
                database: url.pathname.replace(/^\//, ''),
                port: url.port || 5432,
                ssl: dbConfig.ssl ? 'enabled' : 'disabled',
            });
        } catch (error) {
            console.log('Database config: using connection string (details masked)');
        }

        return;
    }

    console.log('Database config:', {
        host: dbConfig.host,
        user: dbConfig.user,
        database: dbConfig.database,
        port: dbConfig.port,
        password: dbConfig.password ? '***SET***' : 'NOT SET'
    });
};

console.log('🚀 Simple Migration Runner');
console.log('========================');
logDbConfig();

async function runMigrations() {
    const pool = new Pool(dbConfig);
    const client = await pool.connect();
    
    try {
        console.log('\n🔄 Testing database connection...');
        const versionResult = await client.query('SELECT version()');
        console.log('✅ Database connected successfully');
        console.log(`📊 Database: ${versionResult.rows[0].version.split(' ')[0]} ${versionResult.rows[0].version.split(' ')[1]}`);
        
        // Create migrations table if it doesn't exist
        console.log('\n🔄 Setting up migrations table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS migrations (
                id SERIAL PRIMARY KEY,
                filename VARCHAR(255) NOT NULL UNIQUE,
                executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);
        console.log('✅ Migrations table ready');
        
        // Get list of migration files
        const migrationDir = path.join(__dirname);
        const migrationFiles = fs.readdirSync(migrationDir)
            .filter(file => file.endsWith('.sql') && !file.includes('migrate'))
            .sort();
        
        console.log(`\n📁 Found ${migrationFiles.length} migration files:`);
        migrationFiles.forEach(file => console.log(`  - ${file}`));
        
        // Get already executed migrations
        const executedResult = await client.query('SELECT filename FROM migrations ORDER BY id');
        const executedMigrations = executedResult.rows.map(row => row.filename);
        
        console.log(`\n📋 Already executed migrations (${executedMigrations.length}):`);
        executedMigrations.forEach(migration => console.log(`  - ${migration}`));
        
        // Run pending migrations
        let executedCount = 0;
        for (const filename of migrationFiles) {
            if (executedMigrations.includes(filename)) {
                console.log(`\n⏭️  Skipping ${filename} (already executed)`);
                continue;
            }
            
            console.log(`\n🔄 Executing ${filename}...`);
            
            try {
                const migrationSQL = fs.readFileSync(path.join(migrationDir, filename), 'utf8');
                
                if (!migrationSQL.trim()) {
                    throw new Error(`Migration file ${filename} is empty`);
                }
                
                console.log(`   SQL preview: ${migrationSQL.substring(0, 100)}${migrationSQL.length > 100 ? '...' : ''}`);
                
                await client.query('BEGIN');
                await client.query(migrationSQL);
                await client.query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);
                await client.query('COMMIT');
                
                console.log(`✅ Successfully executed ${filename}`);
                executedCount++;
                
            } catch (error) {
                await client.query('ROLLBACK');
                
                // Check if this is a "relation already exists" error for initial schema
                if (filename === '001_initial_schema.sql' && error.code === '42P07') {
                    console.log(`⚠️  ${filename} failed because tables already exist`);
                    console.log(`   This is expected if the database was set up manually`);
                    console.log(`   Marking as executed to avoid future conflicts...`);
                    
                    // Mark as executed without running the SQL
                    await client.query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);
                    console.log(`✅ Marked ${filename} as executed`);
                    executedCount++;
                } else {
                    console.error(`❌ Failed to execute ${filename}:`);
                    console.error(`   Error: ${error.message}`);
                    console.error(`   Code: ${error.code || 'N/A'}`);
                    console.error(`   Detail: ${error.detail || 'N/A'}`);
                    console.error(`   Hint: ${error.hint || 'N/A'}`);
                    console.error(`   Position: ${error.position || 'N/A'}`);
                    console.error(`   Where: ${error.where || 'N/A'}`);
                    console.error(`   File: ${error.file || 'N/A'}`);
                    console.error(`   Line: ${error.line || 'N/A'}`);
                    console.error(`   Routine: ${error.routine || 'N/A'}`);
                    console.error(`   SQL State: ${error.sqlState || 'N/A'}`);
                    throw error;
                }
            }
        }
        
        if (executedCount === 0) {
            console.log('\n🎯 No new migrations to execute');
        } else {
            console.log(`\n🎉 Successfully executed ${executedCount} migration(s)!`);
        }
        
        // Show final status
        console.log('\n📊 Final database structure:');
        const structure = await client.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'post_targets' 
            ORDER BY ordinal_position;
        `);
        
        console.log('post_targets table columns:');
        structure.rows.forEach(col => {
            console.log(`  - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
        });
        
    } catch (error) {
        console.error('\n💥 Migration failed:');
        console.error(`   Error: ${error.message}`);
        console.error(`   Type: ${error.constructor.name}`);
        console.error(`   Stack trace:`);
        console.error(error.stack);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
        console.log('\n✅ Database connection closed');
    }
}

// Run migrations
runMigrations();
