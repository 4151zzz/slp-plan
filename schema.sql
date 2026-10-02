-- =====================================================================
-- ฐานข้อมูลระบบส่งแผนการสอนออนไลน์ โรงเรียนสระหลวงพิทยาคม
-- พัฒนาและออกแบบระบบโดย: wunPiyapong
-- รองรับ MySQL 5.7+ / MySQL 8.0+ / MariaDB 10.3+
-- Encoding: UTF-8 Unicode (utf8mb4) รองรับภาษาไทยและอิโมจิ
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET NAMES utf8mb4;

-- ---------------------------------------------------------------------
-- 1. ตาราง academic_terms: ภาคเรียนปีการศึกษา
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `academic_terms` (
  `id` VARCHAR(64) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `is_active` TINYINT(1) DEFAULT 1,
  `start_date` VARCHAR(32) DEFAULT NULL,
  `end_date` VARCHAR(32) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_term_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. ตาราง departments: กลุ่มสาระการเรียนรู้ (8 กลุ่มสาระ)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `departments` (
  `id` VARCHAR(64) NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `head_name` VARCHAR(255) DEFAULT NULL,
  `head_email` VARCHAR(255) DEFAULT NULL,
  `head_pin` VARCHAR(32) DEFAULT '1234',
  `description` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_dept_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. ตาราง users: บัญชีผู้ใช้งานระบบ (ผู้ดูแลระบบ, ผู้บริหาร, ครู)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `role` VARCHAR(64) NOT NULL, -- admin, director, academic_director, academic_head, curriculum_head, dept_head, teacher
  `department` VARCHAR(255) DEFAULT NULL,
  `position_title` VARCHAR(255) NOT NULL,
  `avatar` VARCHAR(64) DEFAULT '👨‍🏫',
  `pin_code` VARCHAR(32) DEFAULT '1234',
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_user_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. ตาราง lesson_plans: ข้อมูลการส่งแผนการสอน
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lesson_plans` (
  `id` VARCHAR(64) NOT NULL,
  `academic_term_id` VARCHAR(64) NOT NULL,
  `teacher_name` VARCHAR(255) NOT NULL,
  `teacher_email` VARCHAR(255) NOT NULL,
  `teacher_department` VARCHAR(255) NOT NULL,
  `subject_code` VARCHAR(64) NOT NULL,
  `subject_name` VARCHAR(255) NOT NULL,
  `grade_level` VARCHAR(64) NOT NULL,
  `file_original_name` VARCHAR(255) DEFAULT NULL,
  `file_size` BIGINT DEFAULT NULL,
  `local_file_path` TEXT DEFAULT NULL,
  `stamped_file_path` TEXT DEFAULT NULL,
  `google_drive_file_id` VARCHAR(255) DEFAULT NULL,
  `google_drive_view_link` TEXT DEFAULT NULL,
  `google_drive_download_link` TEXT DEFAULT NULL,
  `signature_data` LONGTEXT DEFAULT NULL,
  `signed_at` DATETIME DEFAULT NULL,
  `submission_status` VARCHAR(64) NOT NULL DEFAULT 'submitted', -- submitted, under_review, approved, revision_needed
  `current_stage` VARCHAR(64) NOT NULL DEFAULT 'dept_head', -- dept_head, curriculum_head, academic_head, academic_director, director, completed
  `current_reviewer_title` VARCHAR(255) DEFAULT 'หัวหน้ากลุ่มสาระการเรียนรู้',
  `reviewer_feedback` TEXT DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `reviewed_by` VARCHAR(255) DEFAULT NULL,
  `submission_round` INT DEFAULT 1,
  `current_round` INT DEFAULT 1,
  `round_2_status` VARCHAR(64) DEFAULT 'not_started',
  `round_2_stage` VARCHAR(64) DEFAULT 'dept_head',
  `round_2_signature` LONGTEXT DEFAULT NULL,
  `round_2_signed_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_teacher_per_term` (`teacher_email`, `academic_term_id`),
  KEY `idx_term` (`academic_term_id`),
  KEY `idx_teacher` (`teacher_email`),
  KEY `idx_status` (`submission_status`),
  KEY `idx_stage` (`current_stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. ตาราง approval_timeline: ขั้นตอนการตรวจ 5 ระดับ
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `approval_timeline` (
  `id` VARCHAR(64) NOT NULL,
  `lesson_plan_id` VARCHAR(64) NOT NULL,
  `step_order` INT NOT NULL,
  `stage_key` VARCHAR(64) NOT NULL,
  `stage_title` VARCHAR(255) NOT NULL,
  `reviewer_name` VARCHAR(255) DEFAULT NULL,
  `reviewer_role` VARCHAR(255) DEFAULT NULL,
  `status` VARCHAR(64) NOT NULL DEFAULT 'waiting', -- waiting, in_progress, completed, revision_needed
  `feedback` TEXT DEFAULT NULL,
  `action_at` DATETIME DEFAULT NULL,
  `reviewer_signature` LONGTEXT DEFAULT NULL,
  `round_number` INT DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_plan_timeline` (`lesson_plan_id`),
  KEY `idx_round` (`round_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. ตาราง job_tasks: คิวประมวลผลงานแบบ Asynchronous
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `job_tasks` (
  `id` VARCHAR(64) NOT NULL,
  `lesson_plan_id` VARCHAR(64) DEFAULT NULL,
  `status` VARCHAR(64) NOT NULL,
  `progress` INT DEFAULT 0,
  `message` TEXT DEFAULT NULL,
  `error_message` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_plan` (`lesson_plan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- ข้อมูลเริ่มต้น (Clean Initial Data)
-- =====================================================================

-- 1. ภาคเรียนเริ่มต้น
INSERT INTO `academic_terms` (`id`, `code`, `name`, `is_active`, `start_date`, `end_date`) VALUES
('term-2569-1', '1/2569', 'ภาคเรียนที่ 1 ปีการศึกษา 2569 (ภาคเรียนปัจจุบัน)', 1, '2026-05-15', '2026-10-15'),
('term-2568-2', '2/2568', 'ภาคเรียนที่ 2 ปีการศึกษา 2568', 0, '2025-11-01', '2026-03-31')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- 2. กลุ่มสาระการเรียนรู้ 8 กลุ่มสาระ (มาตรฐานกระทรวงศึกษาธิการ)
INSERT INTO `departments` (`id`, `code`, `name`, `head_name`, `head_email`, `head_pin`, `description`) VALUES
('dept-sci', 'sci', 'วิทยาศาสตร์และเทคโนโลยี', NULL, NULL, '1234', 'วิทยาศาสตร์ ฟิสิกส์ เคมี ชีววิทยา และเทคโนโลยีคอมพิวเตอร์'),
('dept-math', 'math', 'คณิตศาสตร์', NULL, NULL, '1234', 'คณิตศาสตร์พื้นฐานและคณิตศาสตร์เพิ่มเติม'),
('dept-thai', 'thai', 'ภาษาไทย', NULL, NULL, '1234', 'ภาษาไทย วรรณคดี และหลักภาษา'),
('dept-foreign', 'foreign', 'ภาษาต่างประเทศ', NULL, NULL, '1234', 'ภาษาอังกฤษ ภาษาจีน ภาษาญี่ปุ่น และภาษาต่างประเทศ'),
('dept-social', 'social', 'สังคมศึกษา ศาสนา และวัฒนธรรม', NULL, NULL, '1234', 'สังคมศึกษา ศาสนา วัฒนธรรม ประวัติศาสตร์ และภูมิศาสตร์'),
('dept-health', 'health', 'สุขศึกษาและพลศึกษา', NULL, NULL, '1234', 'สุขศึกษา พลศึกษา และการสร้างเสริมสุขภาวะ'),
('dept-art', 'art', 'ศิลปะ', NULL, NULL, '1234', 'ทัศนศิลป์ ดนตรี และนาฏศิลป์'),
('dept-career', 'career', 'การงานอาชีพ', NULL, NULL, '1234', 'งานบ้าน งานช่าง งานเกษตร และธุรกิจการงานอาชีพ')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`);

-- 3. บัญชีผู้ดูแลระบบ (Admin) บัญชีเดียวในระบบ
INSERT INTO `users` (`id`, `name`, `email`, `role`, `department`, `position_title`, `avatar`, `pin_code`) VALUES
('u-admin', 'นายปิยะพงษ์ ยะจันโท', 'admin@school.ac.th', 'admin', 'ผู้ดูแลระบบ', 'ผู้ดูแลระบบคอมพิวเตอร์', '💻', '1234')
ON DUPLICATE KEY UPDATE `name`=VALUES(`name`), `role`='admin';

SET FOREIGN_KEY_CHECKS = 1;
