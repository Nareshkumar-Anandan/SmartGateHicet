-- Smart Hostel Gate Management System Database Schema
-- Institution: Hindusthan Institute of Technology (HICET)
-- Hardware Integration: TimeWatch TrueFace3000 (ADPM) & Tripod Turnstiles

CREATE DATABASE IF NOT EXISTS smartgate_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smartgate_db;

-- 1. Users Table (Super Admin, Warden)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    role ENUM('SUPER_ADMIN', 'WARDEN') NOT NULL,
    phone VARCHAR(20) NULL,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_role (role),
    INDEX idx_user_email (email)
) ENGINE=InnoDB;

-- 2. Hostels Table
CREATE TABLE IF NOT EXISTS hostels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    gender_type ENUM('BOYS', 'GIRLS', 'COED') NOT NULL DEFAULT 'BOYS',
    warden_id INT NULL,
    total_rooms INT NOT NULL DEFAULT 0,
    description VARCHAR(255) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (warden_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- 3. Rooms Table
CREATE TABLE IF NOT EXISTS rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hostel_id INT NOT NULL,
    room_number VARCHAR(50) NOT NULL,
    floor INT NOT NULL DEFAULT 1,
    capacity INT NOT NULL DEFAULT 4,
    current_occupancy INT NOT NULL DEFAULT 0,
    status ENUM('AVAILABLE', 'FULL', 'MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_hostel_room (hostel_id, room_number),
    FOREIGN KEY (hostel_id) REFERENCES hostels(id) ON DELETE CASCADE,
    INDEX idx_room_status (status)
) ENGINE=InnoDB;

-- 4. Students Table
CREATE TABLE IF NOT EXISTS students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id VARCHAR(50) UNIQUE NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    course VARCHAR(50) NOT NULL DEFAULT 'B.E.',
    year_of_study INT NOT NULL DEFAULT 1,
    phone VARCHAR(20) NOT NULL,
    parent_phone VARCHAR(20) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hostel_id INT NULL,
    room_id INT NULL,
    current_location_status ENUM('INSIDE', 'OUTSIDE') NOT NULL DEFAULT 'INSIDE',
    biometric_device_id VARCHAR(100) UNIQUE NULL,
    biometric_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
    card_number VARCHAR(50) NULL,
    photo_avatar VARCHAR(255) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (hostel_id) REFERENCES hostels(id) ON DELETE SET NULL,
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
    INDEX idx_student_location (current_location_status),
    INDEX idx_student_biometric (biometric_device_id),
    INDEX idx_student_dept (department)
) ENGINE=InnoDB;

-- 5. Outings Table
CREATE TABLE IF NOT EXISTS outings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    outing_type ENUM('LOCAL_OUTING', 'EMERGENCY', 'HOME_LEAVE') NOT NULL DEFAULT 'LOCAL_OUTING',
    departure_date DATE NOT NULL,
    departure_time TIME NOT NULL,
    expected_return_date DATE NOT NULL,
    expected_return_time TIME NOT NULL,
    actual_departure_time DATETIME NULL,
    actual_return_time DATETIME NULL,
    destination VARCHAR(255) NOT NULL,
    reason TEXT NOT NULL,
    status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'OVERDUE') NOT NULL DEFAULT 'PENDING',
    approved_by_user_id INT NULL,
    approval_remarks TEXT NULL,
    decision_at DATETIME NULL,
    created_by_user_id INT NULL,
    manual_return_confirmed_by INT NULL,
    manual_return_remarks TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
    FOREIGN KEY (approved_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (manual_return_confirmed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_outing_status (status),
    INDEX idx_outing_dates (departure_date, expected_return_date)
) ENGINE=InnoDB;

-- 6. Gate Devices Table (TimeWatch TrueFace3000 + Tripod Turnstiles)
CREATE TABLE IF NOT EXISTS gate_devices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    device_code VARCHAR(50) UNIQUE NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    manufacturer VARCHAR(50) NOT NULL DEFAULT 'TimeWatch',
    model VARCHAR(100) NOT NULL DEFAULT 'TrueFace3000 (ADPM)',
    serial_number VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL DEFAULT '172.25.26.241',
    port INT NOT NULL DEFAULT 8080,
    mac_address VARCHAR(30) NULL,
    location_description VARCHAR(255) NOT NULL,
    lane_direction ENUM('ENTRY', 'EXIT', 'BIDIRECTIONAL') NOT NULL DEFAULT 'BIDIRECTIONAL',
    turnstile_relay_pin INT NOT NULL DEFAULT 1,
    turnstile_unlock_duration_ms INT NOT NULL DEFAULT 3000,
    status ENUM('ONLINE', 'OFFLINE', 'ERROR') NOT NULL DEFAULT 'ONLINE',
    last_heartbeat DATETIME NULL,
    firmware_version VARCHAR(50) DEFAULT 'TW-ADPM-v2.6.4',
    integration_mode ENUM('SIMULATED', 'HARDWARE_API') NOT NULL DEFAULT 'SIMULATED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_device_status (status)
) ENGINE=InnoDB;

-- 7. Gate Events Table
CREATE TABLE IF NOT EXISTS gate_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_uuid VARCHAR(64) UNIQUE NOT NULL,
    device_id INT NOT NULL,
    student_id INT NULL,
    event_timestamp DATETIME NOT NULL,
    direction ENUM('ENTRY', 'EXIT') NOT NULL,
    verification_type ENUM('FACE', 'CARD', 'PASSWORD', 'QR') NOT NULL DEFAULT 'FACE',
    access_result ENUM('GRANTED', 'DENIED') NOT NULL,
    denial_reason VARCHAR(255) NULL,
    related_outing_id INT NULL,
    raw_payload JSON NULL,
    event_source ENUM('SIMULATED', 'MANUAL', 'HARDWARE') NOT NULL DEFAULT 'SIMULATED',
    deduplication_hash VARCHAR(128) NOT NULL,
    processed_status ENUM('PROCESSED', 'IGNORED', 'FAILED') NOT NULL DEFAULT 'PROCESSED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES gate_devices(id) ON DELETE RESTRICT,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    FOREIGN KEY (related_outing_id) REFERENCES outings(id) ON DELETE SET NULL,
    INDEX idx_event_time (event_timestamp),
    INDEX idx_student_event (student_id, event_timestamp),
    INDEX idx_dedup (deduplication_hash),
    INDEX idx_access_result (access_result)
) ENGINE=InnoDB;

-- 8. Audit Logs Table (Tamper-evident record of actions)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    actor_name VARCHAR(150) NOT NULL,
    actor_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(100) NULL,
    details TEXT NULL,
    ip_address VARCHAR(45) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_audit_time (created_at),
    INDEX idx_audit_action (action)
) ENGINE=InnoDB;

-- 9. Incidents Table
CREATE TABLE IF NOT EXISTS incidents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    incident_type ENUM('UNAUTHORIZED_ATTEMPT', 'TAILGATING', 'OVERDUE_BREACH', 'DAMAGE_OR_TAMPER', 'MANUAL_OVERRIDE', 'OTHER') NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    student_id INT NULL,
    gate_device_id INT NULL,
    reported_by_user_id INT NOT NULL,
    assigned_to_user_id INT NULL,
    severity ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    status ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    resolution_notes TEXT NULL,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    FOREIGN KEY (gate_device_id) REFERENCES gate_devices(id) ON DELETE SET NULL,
    FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_incident_status (status),
    INDEX idx_incident_severity (severity)
) ENGINE=InnoDB;

-- 10. System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    description VARCHAR(255) NULL,
    updated_by INT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
