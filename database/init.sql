-- HAL Database Setup Script
-- Run this to create the database and user

-- Create database
CREATE DATABASE hal;

-- Create user (change password!)
CREATE USER hal_user WITH PASSWORD 'hal_password_change_me';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE hal TO hal_user;

-- Connect to hal database
\c hal

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO hal_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hal_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO hal_user;

-- After this, run: npx prisma db push
-- This will create all tables from the Prisma schema
