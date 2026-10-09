import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';

import { initDatabase, db } from './database/db.js';
import { uploadQueue } from './queue/uploadQueue.js';
import { pdfService } from './services/pdfService.js';
import { googleDriveService } from './services/googleDriveService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure upload directories exist
const uploadDir = path.resolve(__dirname, '../data/uploads');
const stampedDir = path.resolve(__dirname, '../data/stamped');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(stampedDir)) fs.mkdirSync(stampedDir, { recursive: true });

// Configure Multer for PDF file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `plan_${Date.now()}_${uuidv4().substring(0, 8)}${ext}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
    cb(null, true);
  } else {
    cb(new Error('รองรับเฉพาะไฟล์เอกสารรูปแบบ PDF เท่านั้น'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max limit
  }
});

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.resolve(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    // Disable caching for HTML/CSS/JS so UI changes appear immediately
    if (filePath.endsWith('.html') || filePath.endsWith('.css') || filePath.endsWith('.js')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

// -------------------------------------------------------------
// Timeline Workflow Helper (5 Approval Tiers: 1.หน.กลุ่มสาระ -> 2.หน.งานหลักสูตร -> 3.หน.บริหารวิชาการ -> 4.รอง ผอ. ฝ่ายวิชาการ -> 5.ผอ.)
// -------------------------------------------------------------
async function initApprovalTimeline(planId, teacherName, currentStage = 'dept_head', submissionStatus = 'submitted', roundNumber = 1) {
  const rNum = parseInt(roundNumber, 10) === 2 ? 2 : 1;
  if (rNum === 1) {
    await db.execute(`DELETE FROM approval_timeline WHERE lesson_plan_id = ? AND (round_number = 1 OR round_number IS NULL)`, [planId]);
  } else {
    await db.execute(`DELETE FROM approval_timeline WHERE lesson_plan_id = ? AND round_number = 2`, [planId]);
  }

  const roundLabel = rNum === 2 ? ' (ครั้งที่ 2)' : '';
  const steps = [
    { order: 1, key: 'dept_head', title: `1. หัวหน้ากลุ่มสาระ${roundLabel}`, role: 'หัวหน้ากลุ่มสาระฯ' },
    { order: 2, key: 'curriculum_head', title: `2. หัวหน้างานหลักสูตร${roundLabel}`, role: 'หัวหน้างานหลักสูตร' },
    { order: 3, key: 'academic_director', title: `3. รองผู้อำนวยการฝ่ายวิชาการ${roundLabel}`, role: 'รองผู้อำนวยการฝ่ายวิชาการ' },
    { order: 4, key: 'director', title: `4. ผู้อำนวยการ${roundLabel}`, role: 'ผู้อำนวยการโรงเรียน' }
  ];

  const stageOrderMap = {
    dept_head: 1,
    curriculum_head: 2,
    academic_director: 3,
    director: 4,
    completed: 5
  };

  const activeOrder = submissionStatus === 'approved' ? 5 : (stageOrderMap[currentStage] || 1);

  for (const s of steps) {
    let status = 'waiting';
    let feedback = null;
    let reviewer = null;

    if (submissionStatus === 'approved' || s.order < activeOrder) {
      status = 'completed';
      feedback = 'เห็นชอบตามเสนอ';
      reviewer = s.role;
    } else if (s.order === activeOrder) {
      if (submissionStatus === 'revision_needed') {
        status = 'revision_needed';
        feedback = 'ส่งกลับเพื่อแก้ไขปรับปรุง';
      } else {
        status = 'in_progress';
      }
    }

    await db.execute(
      `INSERT INTO approval_timeline (id, lesson_plan_id, step_order, stage_key, stage_title, reviewer_name, reviewer_role, status, feedback, action_at, round_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        planId,
        s.order,
        s.key,
        s.title,
        reviewer,
        s.role,
        status,
        feedback,
        status === 'completed' ? new Date().toISOString() : null,
        rNum
      ]
    );
  }
}

// -------------------------------------------------------------
// Authentication & User Profiles
// -------------------------------------------------------------
app.get('/api/auth/users', async (req, res) => {
  try {
    const users = await db.query('SELECT id, name, email, role, department, position_title, avatar FROM users ORDER BY role DESC');
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, userId, pin } = req.body;
    let user = null;
    if (userId) {
      user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    } else if (email) {
      const cleanEmail = email.trim().toLowerCase();
      user = await db.get('SELECT * FROM users WHERE LOWER(email) = ?', [cleanEmail]);

      // If new teacher email is entered, auto-provision user account
      if (!user) {
        const id = 'u-' + uuidv4().substring(0, 8);
        const namePart = cleanEmail.split('@')[0].replace(/[._]/g, ' ');
        const thaiName = `ครู${namePart}`;
        await db.execute(
          `INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) 
           VALUES (?, ?, ?, 'teacher', 'กลุ่มสาระการเรียนรู้ทั่วไป', 'ครูผู้สอน', '👨‍🏫', '1234')`,
          [id, thaiName, cleanEmail]
        );
        user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      }
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'ไม่พบบัญชีผู้ใช้งานในระบบ' });
    }

    // Role-based PIN Security Check for Reviewers and Admins
    const isReviewer = ['dept_head', 'curriculum_head', 'academic_head', 'academic_director', 'director', 'admin'].includes(user.role);
    if (isReviewer) {
      if (!pin) {
        return res.status(401).json({
          success: false,
          requirePin: true,
          role: user.role,
          name: user.name,
          position: user.position_title,
          department: user.department,
          message: 'กรุณากรอกรหัส PIN 4 หลักเพื่อยืนยันตัวตนผู้ตรวจ'
        });
      }

      if (pin.trim() !== (user.pin_code || '1234')) {
        return res.status(401).json({
          success: false,
          requirePin: true,
          message: 'รหัส PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'
        });
      }
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Admin Management APIs (สำหรับหน้า admin.html จัดการข้อมูลโรงเรียน)
// -------------------------------------------------------------

// ดึงรายชื่อผู้ใช้ทั้งหมดในระบบ
app.get('/api/admin/users-list', async (req, res) => {
  try {
    const users = await db.query(
      `SELECT id, name, email, role, department, position_title, avatar, pin_code 
       FROM users 
       ORDER BY 
         CASE role
           WHEN 'director' THEN 1
           WHEN 'academic_director' THEN 2
           WHEN 'academic_head' THEN 3
           WHEN 'curriculum_head' THEN 4
           WHEN 'dept_head' THEN 5
           WHEN 'admin' THEN 6
           ELSE 7
         END, department ASC, name ASC`
    );
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// เพิ่มผู้ใช้งานใหม่ (ครู / หัวหน้ากลุ่มสาระ / ผู้บริหาร / แอดมิน)
app.post('/api/admin/users', async (req, res) => {
  try {
    const { name, email, role, department, position_title, avatar, pin_code } = req.body;
    if (!name || !email || !role) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อ อีเมล และบทบาท' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail]);
    if (existing) {
      return res.status(409).json({ success: false, message: 'อีเมลนี้มีอยู่ในระบบแล้ว' });
    }

    const id = 'u-' + uuidv4().substring(0, 8);
    const defaultAvatar = avatar || (
      role === 'dept_head' ? '👩‍💼' : 
      role === 'curriculum_head' ? '📋' : 
      role === 'academic_head' ? '📚' : 
      role === 'academic_director' ? '👨‍💼' : 
      role === 'director' ? '🏛️' : 
      role === 'admin' ? '💻' : '👨‍🏫'
    );
    const pin = pin_code || '1234';

    await db.execute(
      `INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), cleanEmail, role, department || 'กลุ่มสาระการเรียนรู้ทั่วไป', position_title || 'ครูผู้สอน', defaultAvatar, pin]
    );

    const newUser = await db.get('SELECT * FROM users WHERE id = ?', [id]);

    // Auto-create Google Drive folder in background if user is in a department
    const deptName = newUser.department;
    if (deptName && deptName !== 'ผู้บริหารสถานศึกษา' && deptName !== 'งานหลักสูตรและวิชาการ') {
      googleDriveService.getOrCreateTeacherFolder(deptName, newUser.name).then(folder => {
        console.log(`[Drive Auto-Create] Ready folder for ${newUser.name} in ${deptName} (ID: ${folder?.id})`);
      }).catch(err => {
        console.warn(`[Drive Auto-Create] Notice: ${err.message}`);
      });
    }

    res.status(201).json({ success: true, message: 'เพิ่มผู้ใช้งานสำเร็จ', user: newUser });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// แก้ไขข้อมูลผู้ใช้งาน (เปลี่ยนชื่อ, กลุ่มสาระ, ตำแหน่ง, PIN)
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, department, position_title, avatar, pin_code } = req.body;

    const existing = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }

    const cleanEmail = email ? email.trim().toLowerCase() : existing.email;

    await db.execute(
      `UPDATE users 
       SET name = ?, email = ?, role = ?, department = ?, position_title = ?, avatar = ?, pin_code = ?
       WHERE id = ?`,
      [
        name ? name.trim() : existing.name,
        cleanEmail,
        role || existing.role,
        department || existing.department,
        position_title || existing.position_title,
        avatar || existing.avatar,
        pin_code !== undefined ? pin_code : existing.pin_code,
        id
      ]
    );

    const updated = await db.get('SELECT * FROM users WHERE id = ?', [id]);

    // Auto-create/sync Google Drive folder if user department or name changed
    const deptName = updated.department;
    if (deptName && deptName !== 'ผู้บริหารสถานศึกษา' && deptName !== 'งานหลักสูตรและวิชาการ') {
      googleDriveService.getOrCreateTeacherFolder(deptName, updated.name).catch(err => {
        console.warn(`[Drive Auto-Create] Notice: ${err.message}`);
      });
    }

    res.json({ success: true, message: 'อัปเดตข้อมูลผู้ใช้งานสำเร็จ', user: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ลบผู้ใช้งาน
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }

    await db.execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true, message: `ลบบัญชี ${existing.name} เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// รีเซ็ตรหัส PIN ของผู้ใช้งาน
app.put('/api/admin/users/:id/reset-pin', async (req, res) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'ไม่พบผู้ใช้งานนี้ในระบบ' });
    }

    const newPin = (pin && String(pin).trim().length === 4) ? String(pin).trim() : '1234';
    await db.execute('UPDATE users SET pin_code = ? WHERE id = ?', [newPin, id]);

    // If this user is a department head, sync head_pin in departments table as well
    if (user.role === 'dept_head' && user.department) {
      await db.execute('UPDATE departments SET head_pin = ? WHERE name = ?', [newPin, user.department]);
    }

    res.json({
      success: true,
      message: `รีเซ็ตรหัส PIN ของ ${user.name} เป็น "${newPin}" เรียบร้อยแล้ว`,
      newPin
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// เพิ่มภาคเรียนใหม่
app.post('/api/admin/terms', async (req, res) => {
  try {
    const { code, name, start_date, end_date, is_active } = req.body;
    if (!code || !name) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุรหัสภาคเรียนและชื่อภาคเรียน' });
    }

    const id = 'term-' + code.replace(/[^a-zA-Z0-9]/g, '-');
    if (is_active) {
      await db.execute('UPDATE academic_terms SET is_active = 0');
    }

    await db.execute(
      `INSERT INTO academic_terms (id, code, name, is_active, start_date, end_date) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, code.trim(), name.trim(), is_active ? 1 : 0, start_date || '', end_date || '']
    );

    res.status(201).json({ success: true, message: 'เพิ่มภาคเรียนสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// แก้ไขข้อมูลภาคเรียน
app.put('/api/admin/terms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, name, start_date, end_date } = req.body;
    const term = await db.get('SELECT * FROM academic_terms WHERE id = ?', [id]);
    if (!term) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลภาคเรียน' });
    }

    await db.execute(
      `UPDATE academic_terms 
       SET code = ?, name = ?, start_date = ?, end_date = ? 
       WHERE id = ?`,
      [
        code ? code.trim() : term.code,
        name ? name.trim() : term.name,
        start_date !== undefined ? start_date : term.start_date,
        end_date !== undefined ? end_date : term.end_date,
        id
      ]
    );

    res.json({ success: true, message: 'อัปเดตข้อมูลภาคเรียนสำเร็จ' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// สลับเปิด-ปิดรับแผนการสอนของภาคเรียน (Toggle Open/Close)
app.put('/api/admin/terms/:id/toggle', async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;
    const term = await db.get('SELECT * FROM academic_terms WHERE id = ?', [id]);
    if (!term) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลภาคเรียน' });
    }

    let newState = active !== undefined ? (active ? 1 : 0) : (term.is_active ? 0 : 1);

    if (newState === 1) {
      // เปิดรับแผนสำหรับภาคเรียนนี้ (ปิดภาคอื่น)
      await db.execute('UPDATE academic_terms SET is_active = 0');
      await db.execute('UPDATE academic_terms SET is_active = 1 WHERE id = ?', [id]);
      res.json({ 
        success: true, 
        message: `เปิดรับแผนการสอนสำหรับ "${term.name}" เรียบร้อยแล้ว`, 
        is_active: 1 
      });
    } else {
      // ปิดรับแผนสำหรับภาคเรียนนี้
      await db.execute('UPDATE academic_terms SET is_active = 0 WHERE id = ?', [id]);
      res.json({ 
        success: true, 
        message: `ปิดรับแผนการสอนสำหรับ "${term.name}" เรียบร้อยแล้ว`, 
        is_active: 0 
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// เปิดรับแผนการสอนภาคเรียนนี้ (Activate)
app.put('/api/admin/terms/:id/activate', async (req, res) => {
  try {
    const { id } = req.params;
    const term = await db.get('SELECT * FROM academic_terms WHERE id = ?', [id]);
    if (!term) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลภาคเรียน' });
    }
    await db.execute('UPDATE academic_terms SET is_active = 0');
    await db.execute('UPDATE academic_terms SET is_active = 1 WHERE id = ?', [id]);
    res.json({ success: true, message: `เปิดรับแผนการสอนสำหรับ "${term.name}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ปิดรับแผนการสอนภาคเรียนนี้ (Deactivate)
app.put('/api/admin/terms/:id/deactivate', async (req, res) => {
  try {
    const { id } = req.params;
    const term = await db.get('SELECT * FROM academic_terms WHERE id = ?', [id]);
    if (!term) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลภาคเรียน' });
    }
    await db.execute('UPDATE academic_terms SET is_active = 0 WHERE id = ?', [id]);
    res.json({ success: true, message: `ปิดรับแผนการสอนสำหรับ "${term.name}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ลบภาคเรียน (ป้องกันหากมีแผนสังกัดอยู่)
app.delete('/api/admin/terms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const term = await db.get('SELECT * FROM academic_terms WHERE id = ?', [id]);
    if (!term) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลภาคเรียน' });
    }

    const planCount = await db.get('SELECT COUNT(*) as count FROM lesson_plans WHERE academic_term_id = ?', [id]);
    if (planCount && planCount.count > 0) {
      return res.status(400).json({
        success: false,
        message: `ไม่สามารถลบภาคเรียน "${term.name}" ได้ เนื่องจากมีแผนการสอนสังกัดอยู่ ${planCount.count} รายการ`
      });
    }

    await db.execute('DELETE FROM academic_terms WHERE id = ?', [id]);
    res.json({ success: true, message: `ลบภาคเรียน "${term.name}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// สรุปสถิติภาพรวมสำหรับ Dashboard
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalPlans = await db.get('SELECT COUNT(*) as count FROM lesson_plans');
    const approvedPlans = await db.get("SELECT COUNT(*) as count FROM lesson_plans WHERE submission_status = 'approved'");
    const pendingPlans = await db.get("SELECT COUNT(*) as count FROM lesson_plans WHERE submission_status IN ('submitted', 'under_review')");
    const revisionPlans = await db.get("SELECT COUNT(*) as count FROM lesson_plans WHERE submission_status = 'revision_needed'");

    const deptStats = await db.query(
      `SELECT teacher_department as department, COUNT(*) as count,
              SUM(CASE WHEN submission_status = 'approved' THEN 1 ELSE 0 END) as approved,
              SUM(CASE WHEN submission_status IN ('submitted', 'under_review') THEN 1 ELSE 0 END) as pending
       FROM lesson_plans 
       GROUP BY teacher_department 
       ORDER BY count DESC`
    );

    const totalTeachers = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'teacher'");
    const totalReviewers = await db.get("SELECT COUNT(*) as count FROM users WHERE role != 'teacher'");

    res.json({
      success: true,
      data: {
        totalPlans: totalPlans ? totalPlans.count : 0,
        approvedPlans: approvedPlans ? approvedPlans.count : 0,
        pendingPlans: pendingPlans ? pendingPlans.count : 0,
        revisionPlans: revisionPlans ? revisionPlans.count : 0,
        totalTeachers: totalTeachers ? totalTeachers.count : 0,
        totalReviewers: totalReviewers ? totalReviewers.count : 0,
        deptStats: deptStats || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// Department & Head Management APIs (จัดการกลุ่มสาระฯ / หมวดวิชา)
// -------------------------------------------------------------

// ดึงรายชื่อกลุ่มสาระการเรียนรู้ทั้งหมด พร้อมสถิติจำนวนแผนและครู
app.get('/api/departments', async (req, res) => {
  try {
    const departments = await db.query(
      `SELECT d.*, 
              (SELECT COUNT(*) FROM lesson_plans lp WHERE lp.teacher_department = d.name) as plan_count,
              (SELECT COUNT(*) FROM users u WHERE u.department = d.name) as teacher_count
       FROM departments d 
       ORDER BY d.created_at ASC`
    );
    res.json({ success: true, data: departments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// เพิ่มกลุ่มสาระการเรียนรู้ / หมวดวิชาใหม่
app.post('/api/departments', async (req, res) => {
  try {
    const { name, code, head_name, head_email, head_pin, description } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อกลุ่มสาระฯ และรหัสหมวด' });
    }

    const cleanCode = code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const cleanName = name.trim();

    // Check duplicate code or name
    const existing = await db.get(
      'SELECT id FROM departments WHERE LOWER(code) = ? OR LOWER(name) = ?', 
      [cleanCode, cleanName.toLowerCase()]
    );
    if (existing) {
      return res.status(409).json({ success: false, message: 'มีรหัสหรือชื่อกลุ่มสาระการเรียนรู้นี้ในระบบแล้ว' });
    }

    const id = 'dept-' + cleanCode;
    const pin = head_pin ? head_pin.trim() : '1234';
    const cleanHeadEmail = head_email ? head_email.trim().toLowerCase() : `head.${cleanCode}@school.ac.th`;
    const headName = head_name ? head_name.trim() : `หัวหน้ากลุ่มสาระฯ ${cleanName}`;

    await db.execute(
      `INSERT INTO departments (id, code, name, head_name, head_email, head_pin, description) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, cleanCode, cleanName, headName, cleanHeadEmail, pin, description || '']
    );

    // If head email is provided, ensure user account is created or updated
    if (cleanHeadEmail) {
      const existingUser = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [cleanHeadEmail]);
      if (existingUser) {
        await db.execute(
          `UPDATE users 
           SET role = 'dept_head', department = ?, name = ?, position_title = ?, pin_code = ? 
           WHERE id = ?`,
          [cleanName, headName, `หัวหน้ากลุ่มสาระฯ ${cleanName}`, pin, existingUser.id]
        );
      } else {
        const uId = `u-head-${cleanCode}`;
        await db.execute(
          `INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) 
           VALUES (?, ?, ?, 'dept_head', ?, ?, '👨‍🏫', ?)`,
          [uId, headName, cleanHeadEmail, cleanName, `หัวหน้ากลุ่มสาระฯ ${cleanName}`, pin]
        );
      }
    }

    const created = await db.get('SELECT * FROM departments WHERE id = ?', [id]);
    res.status(201).json({ success: true, message: 'เพิ่มกลุ่มสาระการเรียนรู้ใหม่สำเร็จ', data: created });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// แก้ไขกลุ่มสาระฯ / เปลี่ยนตัวหรือแต่งตั้งหัวหน้าหมวดวิชา
app.put('/api/departments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, head_name, head_email, head_pin, description } = req.body;

    const current = await db.get('SELECT * FROM departments WHERE id = ?', [id]);
    if (!current) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลกลุ่มสาระฯ นี้ในระบบ' });
    }

    const newName = name ? name.trim() : current.name;
    const newHeadName = head_name ? head_name.trim() : current.head_name;
    const newHeadEmail = head_email ? head_email.trim().toLowerCase() : current.head_email;
    const newPin = head_pin ? head_pin.trim() : current.head_pin;
    const newDesc = description !== undefined ? description : current.description;

    await db.execute(
      `UPDATE departments 
       SET name = ?, head_name = ?, head_email = ?, head_pin = ?, description = ? 
       WHERE id = ?`,
      [newName, newHeadName, newHeadEmail, newPin, newDesc, id]
    );

    // Synchronize or assign Head User account
    if (newHeadEmail) {
      const existingUser = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [newHeadEmail]);
      if (existingUser) {
        await db.execute(
          `UPDATE users 
           SET role = 'dept_head', department = ?, name = ?, position_title = ?, pin_code = ? 
           WHERE id = ?`,
          [newName, newHeadName, `หัวหน้ากลุ่มสาระฯ ${newName}`, newPin, existingUser.id]
        );
      } else {
        const uId = `u-head-${current.code || uuidv4().substring(0, 6)}`;
        await db.execute(
          `INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) 
           VALUES (?, ?, ?, 'dept_head', ?, ?, '👨‍🏫', ?)`,
          [uId, newHeadName, newHeadEmail, newName, `หัวหน้ากลุ่มสาระฯ ${newName}`, newPin]
        );
      }
    }

    // If department name was changed, sync plans and users
    if (newName !== current.name) {
      await db.execute(`UPDATE lesson_plans SET teacher_department = ? WHERE teacher_department = ?`, [newName, current.name]);
      await db.execute(`UPDATE users SET department = ? WHERE department = ?`, [newName, current.name]);
    }

    const updated = await db.get('SELECT * FROM departments WHERE id = ?', [id]);
    res.json({ success: true, message: 'อัปเดตข้อมูลกลุ่มสาระการเรียนรู้เรียบร้อยแล้ว', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ลบกลุ่มสาระการเรียนรู้ (ป้องกันการลบหากมีแผนการสอนสังกัดอยู่)
app.delete('/api/departments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const dept = await db.get('SELECT * FROM departments WHERE id = ?', [id]);
    if (!dept) {
      return res.status(404).json({ success: false, message: 'ไม่พบกลุ่มสาระฯ นี้ในระบบ' });
    }

    // Check if plans exist
    const planCount = await db.get('SELECT COUNT(*) as count FROM lesson_plans WHERE teacher_department = ?', [dept.name]);
    if (planCount && planCount.count > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `ไม่สามารถลบกลุ่มสาระฯ "${dept.name}" ได้ เนื่องจากมีแผนการสอนจำนวน ${planCount.count} รายการสังกัดอยู่` 
      });
    }

    await db.execute('DELETE FROM departments WHERE id = ?', [id]);
    res.json({ success: true, message: `ลบกลุ่มสาระฯ "${dept.name}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// รีเซ็ตรหัส PIN ของหัวหน้ากลุ่มสาระฯ
app.put('/api/departments/:id/reset-pin', async (req, res) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    const dept = await db.get('SELECT * FROM departments WHERE id = ?', [id]);
    if (!dept) {
      return res.status(404).json({ success: false, message: 'ไม่พบกลุ่มสาระฯ นี้ในระบบ' });
    }

    const newPin = (pin && String(pin).trim().length === 4) ? String(pin).trim() : '1234';
    await db.execute('UPDATE departments SET head_pin = ? WHERE id = ?', [newPin, id]);

    // Also sync the head user's pin_code if exists
    if (dept.head_email) {
      await db.execute('UPDATE users SET pin_code = ? WHERE LOWER(email) = ?', [newPin, dept.head_email.toLowerCase()]);
    }

    res.json({
      success: true,
      message: `รีเซ็ตรหัส PIN ของหัวหน้ากลุ่มสาระฯ ${dept.name} เป็น "${newPin}" เรียบร้อยแล้ว`,
      newPin
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ตรวจสอบความสมบูรณ์ของระบบไทม์ไลน์ 5 ขั้นตอน และซ่อมแซมหากมีแผนการสอนเดิมค้างอยู่
app.post('/api/admin/system/verify-timelines', async (req, res) => {
  try {
    const plans = await db.query('SELECT id, submission_status FROM lesson_plans');
    let repairedCount = 0;

    const stages = [
      { step: 1, key: 'dept_head', title: 'หัวหน้ากลุ่มสาระการเรียนรู้' },
      { step: 2, key: 'curriculum_head', title: 'หัวหน้างานหลักสูตร' },
      { step: 3, key: 'academic_head', title: 'หัวหน้ากลุ่มบริหารวิชาการ' },
      { step: 4, key: 'academic_director', title: 'รองผู้อำนวยการฝ่ายวิชาการ' },
      { step: 5, key: 'director', title: 'ผู้อำนวยการโรงเรียน' }
    ];

    for (const plan of plans) {
      const existingSteps = await db.query(
        'SELECT stage_key, status FROM approval_timeline WHERE lesson_plan_id = ?',
        [plan.id]
      );
      const existingKeys = new Set(existingSteps.map(s => s.stage_key));

      let needsRepair = false;
      for (const s of stages) {
        if (!existingKeys.has(s.key)) {
          needsRepair = true;
          const status = plan.submission_status === 'approved' ? 'completed' : 'pending';
          await db.execute(
            `INSERT INTO approval_timeline (id, lesson_plan_id, step_order, stage_key, stage_title, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [uuidv4(), plan.id, s.step, s.key, s.title, status]
          );
        }
      }
      if (needsRepair) repairedCount++;
    }

    res.json({
      success: true,
      message: `ตรวจสอบไทม์ไลน์เรียบร้อยแล้ว (ตรวจพบและซ่อมแซม ${repairedCount} แผนการสอน)`,
      totalPlans: plans.length,
      repairedCount
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 1. Get Academic Terms
app.get('/api/terms', async (req, res) => {
  try {
    const terms = await db.query('SELECT * FROM academic_terms ORDER BY is_active DESC, code DESC');
    res.json({ success: true, data: terms });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Pre-flight Duplicate Check
app.get('/api/plans/check-duplicate', async (req, res) => {
  try {
    const { email, term_id } = req.query;
    if (!email || !term_id) {
      return res.status(400).json({ success: false, message: 'กรุณาระบุอีเมลและภาคเรียน' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await db.get(
      `SELECT lp.*, t.name as term_name 
       FROM lesson_plans lp 
       JOIN academic_terms t ON lp.academic_term_id = t.id 
       WHERE LOWER(lp.teacher_email) = ? AND lp.academic_term_id = ?`,
      [cleanEmail, term_id]
    );

    if (existing) {
      const canEdit = existing.submission_status === 'draft' || existing.submission_status === 'revision_needed';
      return res.json({
        exists: true,
        canEdit,
        status: existing.submission_status,
        message: canEdit 
          ? 'คุณมีแผนการสอนในภาคเรียนนี้แล้ว (สามารถแก้ไขหรือส่งฉบับปรับปรุงได้)'
          : 'คุณได้ส่งแผนการสอนสำหรับภาคเรียนนี้ไปแล้ว',
        plan: {
          id: existing.id,
          subject_code: existing.subject_code,
          subject_name: existing.subject_name,
          submission_status: existing.submission_status,
          created_at: existing.created_at,
          reviewer_feedback: existing.reviewer_feedback,
          google_drive_view_link: existing.google_drive_view_link
        }
      });
    }

    return res.json({ exists: false, canEdit: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Submit New Lesson Plan (High-Concurrency Non-Blocking + Strict Duplicate Prevention)
app.post('/api/plans/submit', upload.single('pdf_file'), async (req, res) => {
  try {
    const {
      teacher_name,
      teacher_email,
      teacher_department,
      subject_code,
      subject_name,
      grade_level,
      academic_term_id,
      signature_data
    } = req.body;

    if (!teacher_name || !teacher_email || !subject_code || !academic_term_id) {
      return res.status(400).json({
        success: false,
        message: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน (ชื่อครู, อีเมล, รหัสวิชา, ภาคเรียน)'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'กรุณาแนบไฟล์แผนการสอน (PDF)'
      });
    }

    const cleanEmail = teacher_email.trim().toLowerCase();
    const submissionRound = parseInt(req.body.submission_round, 10) === 2 ? 2 : 1;

    // STRICT BUSINESS RULE: Check duplicate at DB level
    const existingPlan = await db.get(
      `SELECT * FROM lesson_plans WHERE LOWER(teacher_email) = ? AND academic_term_id = ?`,
      [cleanEmail, academic_term_id]
    );

    if (existingPlan) {
      if (submissionRound === 2) {
        // Teacher submitting for Round 2 on existing plan
        const planId = existingPlan.id;
        const filePath = req.file ? req.file.path : existingPlan.local_file_path;
        await db.execute(
          `UPDATE lesson_plans 
           SET round_2_signature = ?,
               round_2_signed_at = CURRENT_TIMESTAMP,
               round_2_status = 'submitted',
               round_2_stage = 'dept_head',
               current_round = 2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [signature_data || null, planId]
        );

        await initApprovalTimeline(planId, teacher_name.trim(), 'dept_head', 'submitted', 2);

        // Stamp Teacher Signature in Column 2
        try {
          await pdfService.stampSignature({
            sourcePdfPath: filePath,
            signatureBase64: signature_data,
            planId,
            teacherName: teacher_name.trim(),
            subjectCode: subject_code.trim().toUpperCase(),
            termName: 'Term',
            signedAt: new Date(),
            column: 2
          });
        } catch (stampErr) {
          console.warn('[Submit Round 2 Stamp Error]:', stampErr.message);
        }

        return res.status(200).json({
          success: true,
          message: 'ส่งและลงนามแผนการสอน ครั้งที่ 2 เรียบร้อยแล้ว ระบบส่งต่อให้หัวหน้ากลุ่มสาระฯ ตรวจสอบ',
          planId
        });
      }

      // Remove uploaded file if duplicate rejected
      if (req.file.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      const canEdit = existingPlan.submission_status === 'draft' || existingPlan.submission_status === 'revision_needed';

      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_SUBMISSION',
        message: 'คุณได้ส่งแผนการสอนสำหรับภาคเรียนนี้ไปแล้ว',
        canEdit,
        existingPlan: {
          id: existingPlan.id,
          subject_code: existingPlan.subject_code,
          subject_name: existingPlan.subject_name,
          submission_status: existingPlan.submission_status,
          created_at: existingPlan.created_at,
          reviewer_feedback: existingPlan.reviewer_feedback,
          google_drive_view_link: existingPlan.google_drive_view_link
        }
      });
    }

    // Get term name for folder/file tagging
    const term = await db.get(`SELECT name FROM academic_terms WHERE id = ?`, [academic_term_id]);
    const termName = term ? term.name : 'UnknownTerm';

    // Insert record with unique constraint safety
    const planId = uuidv4();
    await db.execute(
      `INSERT INTO lesson_plans (
        id, academic_term_id, teacher_name, teacher_email, teacher_department,
        subject_code, subject_name, grade_level, file_original_name, file_size,
        local_file_path, signature_data, signed_at, submission_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'submitted')`,
      [
        planId,
        academic_term_id,
        teacher_name.trim(),
        cleanEmail,
        teacher_department || 'ไม่ระบุ',
        subject_code.trim().toUpperCase(),
        subject_name || '',
        grade_level || '',
        req.file.originalname,
        req.file.size,
        req.file.path,
        signature_data || null
      ]
    );

    // Initialize Multi-Tier Review Timeline
    await initApprovalTimeline(planId, teacher_name.trim());

    // Fast asynchronous background job dispatch
    const jobId = uuidv4();
    await uploadQueue.addJob({
      jobId,
      planId,
      localFilePath: req.file.path,
      signatureData: signature_data,
      teacherName: teacher_name.trim(),
      departmentName: teacher_department,
      subjectCode: subject_code.trim().toUpperCase(),
      termName
    });

    // Return 202 Accepted immediately to prevent blocking the teacher
    return res.status(202).json({
      success: true,
      message: 'รับข้อมูลและนำเข้าคิวประมวลผลสำเร็จ กำลังประทับตราและส่ง Google Drive ในพื้นหลัง',
      jobId,
      planId
    });

  } catch (err) {
    console.error('[Submit Error]', err);
    // Handle unique constraint violation gracefully if caught in race condition
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('unique_teacher_per_term'))) {
      return res.status(409).json({
        success: false,
        error: 'DUPLICATE_SUBMISSION',
        message: 'คุณได้ส่งแผนการสอนสำหรับภาคเรียนนี้ไปแล้ว',
        canEdit: false
      });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update / Edit Existing Plan (Allowed when status is 'draft' or 'revision_needed')
app.put('/api/plans/:id', upload.single('pdf_file'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      teacher_name,
      teacher_department,
      subject_code,
      subject_name,
      grade_level,
      signature_data
    } = req.body;

    const existing = await db.get(`SELECT * FROM lesson_plans WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลแผนการสอนที่ต้องการแก้ไข' });
    }

    if (existing.submission_status !== 'draft' && existing.submission_status !== 'revision_needed') {
      return res.status(403).json({
        success: false,
        message: `ไม่สามารถแก้ไขได้เนื่องจากสถานะปัจจุบันคือ "${existing.submission_status}" (แก้ไขได้เฉพาะสถานะ 'ร่าง' หรือ 'ต้องแก้ไข')`
      });
    }

    let filePath = existing.local_file_path;
    let fileName = existing.file_original_name;
    let fileSize = existing.file_size;

    if (req.file) {
      filePath = req.file.path;
      fileName = req.file.originalname;
      fileSize = req.file.size;
    }

    const term = await db.get(`SELECT name FROM academic_terms WHERE id = ?`, [existing.academic_term_id]);
    const termName = term ? term.name : 'UnknownTerm';

    await db.execute(
      `UPDATE lesson_plans 
       SET teacher_name = ?,
           teacher_department = ?,
           subject_code = ?,
           subject_name = ?,
           grade_level = ?,
           file_original_name = ?,
           file_size = ?,
           local_file_path = ?,
           signature_data = COALESCE(?, signature_data),
           submission_status = 'submitted',
           current_stage = 'dept_head',
           current_reviewer_title = 'หัวหน้ากลุ่มสาระการเรียนรู้',
           reviewer_feedback = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        teacher_name || existing.teacher_name,
        teacher_department || existing.teacher_department,
        (subject_code || existing.subject_code).toUpperCase(),
        subject_name || existing.subject_name,
        grade_level || existing.grade_level,
        fileName,
        fileSize,
        filePath,
        signature_data || null,
        id
      ]
    );

    // Re-initialize timeline starting at dept_head
    await initApprovalTimeline(id, teacher_name || existing.teacher_name);

    // Enqueue background processing for updated plan
    const jobId = uuidv4();
    await uploadQueue.addJob({
      jobId,
      planId: id,
      localFilePath: filePath,
      signatureData: signature_data || existing.signature_data,
      teacherName: teacher_name || existing.teacher_name,
      departmentName: teacher_department || existing.teacher_department,
      subjectCode: (subject_code || existing.subject_code).toUpperCase(),
      termName
    });

    res.json({
      success: true,
      message: 'อัปเดตแผนการสอนและส่งเข้าคิวประมวลผลเรียบร้อย',
      jobId,
      planId: id
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Job Status & Real-time SSE
app.get('/api/jobs/:id/status', async (req, res) => {
  try {
    const job = await uploadQueue.getJobStatus(req.params.id);
    if (!job) {
      return res.status(404).json({ success: false, message: 'ไม่พบงานในระบบคิว' });
    }
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/jobs/:id/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  uploadQueue.subscribeSSE(req.params.id, res);
});

// 6. Get Plan by ID or Teacher's Plans
app.get('/api/plans/:id', async (req, res) => {
  try {
    const plan = await db.get(
      `SELECT lp.*, t.name as term_name, t.code as term_code 
       FROM lesson_plans lp 
       JOIN academic_terms t ON lp.academic_term_id = t.id 
       WHERE lp.id = ?`,
      [req.params.id]
    );
    if (!plan) return res.status(404).json({ success: false, message: 'ไม่พบแผนการสอน' });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/plans/teacher/:email', async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const plans = await db.query(
      `SELECT lp.*, t.name as term_name, t.code as term_code 
       FROM lesson_plans lp 
       JOIN academic_terms t ON lp.academic_term_id = t.id 
       WHERE LOWER(lp.teacher_email) = ? 
       ORDER BY lp.created_at DESC`,
      [email]
    );

    // Attach timeline steps to each plan for direct instant display
    for (const p of plans) {
      let timeline = await db.query(
        `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? ORDER BY step_order ASC`,
        [p.id]
      );
      if (!timeline || timeline.length === 0) {
        await initApprovalTimeline(p.id, p.teacher_name);
        timeline = await db.query(
          `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? ORDER BY step_order ASC`,
          [p.id]
        );
      }
      p.timeline = timeline;
    }

    res.json({ success: true, data: plans });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Academic Reviewer / Admin API
app.get('/api/admin/plans', async (req, res) => {
  try {
    const { term_id, department, status, search, reviewer_role, reviewer_dept, filter_mode } = req.query;
    let sql = `
      SELECT lp.*, t.name as term_name, t.code as term_code 
      FROM lesson_plans lp 
      JOIN academic_terms t ON lp.academic_term_id = t.id 
      WHERE 1=1
    `;
    const params = [];

    if (term_id) {
      sql += ` AND lp.academic_term_id = ?`;
      params.push(term_id);
    }
    // Enforce strict department boundary if reviewer is a department head
    if (reviewer_role === 'dept_head' && reviewer_dept) {
      sql += ` AND lp.teacher_department = ?`;
      params.push(reviewer_dept);
    } else if (department) {
      sql += ` AND lp.teacher_department = ?`;
      params.push(department);
    }

    // Role-Aware Filter Mode logic
    const validReviewerStages = ['dept_head', 'curriculum_head', 'academic_head', 'academic_director', 'director'];
    if (filter_mode === 'my_turn') {
      if (validReviewerStages.includes(reviewer_role)) {
        sql += ` AND lp.current_stage = ? AND lp.submission_status IN ('submitted', 'under_review')`;
        params.push(reviewer_role);
      } else {
        sql += ` AND lp.submission_status IN ('submitted', 'under_review')`;
      }
    } else if (filter_mode === 'approved') {
      sql += ` AND lp.submission_status = 'approved'`;
    } else if (filter_mode === 'waiting_others') {
      if (validReviewerStages.includes(reviewer_role)) {
        sql += ` AND lp.submission_status IN ('submitted', 'under_review') AND (lp.current_stage IS NULL OR lp.current_stage != ?)`;
        params.push(reviewer_role);
      } else {
        sql += ` AND lp.submission_status IN ('submitted', 'under_review')`;
      }
    } else if (filter_mode === 'revision') {
      sql += ` AND lp.submission_status = 'revision_needed'`;
    } else if (status) {
      sql += ` AND lp.submission_status = ?`;
      params.push(status);
    }

    if (search) {
      sql += ` AND (lp.teacher_name LIKE ? OR lp.teacher_email LIKE ? OR lp.subject_code LIKE ? OR lp.subject_name LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    sql += ` ORDER BY lp.created_at DESC`;
    const rows = await db.query(sql, params);

    // Fetch timeline steps for all plans in bulk
    for (const p of rows) {
      let timeline = await db.query(
        `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? ORDER BY step_order ASC`,
        [p.id]
      );
      if (!timeline || timeline.length === 0 || timeline.length < 4) {
        await initApprovalTimeline(p.id, p.teacher_name, p.current_stage, p.submission_status);
        timeline = await db.query(
          `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? ORDER BY step_order ASC`,
          [p.id]
        );
      }
      p.timeline = timeline;
    }

    // Compute scope counts for badges & KPIs
    let countSql = `SELECT lp.submission_status, lp.current_stage, lp.teacher_department, lp.round_2_status, lp.round_2_stage, lp.current_round FROM lesson_plans lp WHERE 1=1`;
    const countParams = [];
    if (term_id) {
      countSql += ` AND lp.academic_term_id = ?`;
      countParams.push(term_id);
    }
    if (reviewer_role === 'dept_head' && reviewer_dept) {
      countSql += ` AND lp.teacher_department = ?`;
      countParams.push(reviewer_dept);
    }

    const allPlansForCounts = await db.query(countSql, countParams);
    let countMyTurn = 0;
    let countApproved = 0;
    let countWaitingOthers = 0;
    let countRevision = 0;
    const countTotal = allPlansForCounts.length;

    for (const item of allPlansForCounts) {
      const hasRound2 = (item.current_round === 2 || (item.round_2_status && item.round_2_status !== 'not_started'));
      const r1Approved = item.submission_status === 'approved';
      const r2Approved = item.round_2_status === 'approved';
      const r1Revision = item.submission_status === 'revision_needed';
      const r2Revision = item.round_2_status === 'revision_needed';

      const isMyTurnR1 = ['submitted', 'under_review'].includes(item.submission_status) && 
        (reviewer_role === 'admin' || item.current_stage === reviewer_role);
      const isMyTurnR2 = hasRound2 && ['submitted', 'under_review'].includes(item.round_2_status) && 
        (reviewer_role === 'admin' || (item.round_2_stage || 'dept_head') === reviewer_role);

      const isMyTurn = isMyTurnR1 || isMyTurnR2;
      const isFullyApproved = hasRound2 ? (r1Approved && r2Approved) : r1Approved;
      const isRevision = r1Revision || r2Revision;

      if (isFullyApproved) {
        countApproved++;
      } else if (isRevision) {
        countRevision++;
      } else if (isMyTurn) {
        countMyTurn++;
      } else {
        countWaitingOthers++;
      }
    }

    res.json({
      success: true,
      data: rows,
      counts: {
        my_turn: countMyTurn,
        approved: countApproved,
        waiting_others: countWaitingOthers,
        revision: countRevision,
        total: countTotal
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Review Action (Approve / Request Revision)
app.post('/api/admin/plans/:id/review', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback, reviewed_by } = req.body;

    if (!['approved', 'revision_needed', 'under_review'].includes(status)) {
      return res.status(400).json({ success: false, message: 'สถานะไม่ถูกต้อง' });
    }

    await db.execute(
      `UPDATE lesson_plans 
       SET submission_status = ?, 
           reviewer_feedback = ?, 
           reviewed_by = ?, 
           reviewed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [status, feedback || '', reviewed_by || 'หัวหน้ากลุ่มสาระฯ', id]
    );

    res.json({ success: true, message: 'บันทึกผลการตรวจสอบเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.1. Get Approval Timeline for a Plan
app.get('/api/plans/:id/timeline', async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await db.get(
      `SELECT lp.*, t.name as term_name, t.code as term_code 
       FROM lesson_plans lp 
       JOIN academic_terms t ON lp.academic_term_id = t.id 
       WHERE lp.id = ?`,
      [id]
    );

    if (!plan) {
      return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลแผนการสอน' });
    }

    let timelineRound1 = await db.query(
      `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? AND (round_number = 1 OR round_number IS NULL) ORDER BY step_order ASC`,
      [id]
    );

    // If timeline doesn't exist yet or is less than 4 steps, initialize it on the fly
    if (!timelineRound1 || timelineRound1.length === 0 || timelineRound1.length < 4) {
      await initApprovalTimeline(id, plan.teacher_name, plan.current_stage || 'dept_head', plan.submission_status || 'submitted', 1);
      timelineRound1 = await db.query(
        `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? AND (round_number = 1 OR round_number IS NULL) ORDER BY step_order ASC`,
        [id]
      );
    }

    let timelineRound2 = await db.query(
      `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? AND round_number = 2 ORDER BY step_order ASC`,
      [id]
    );

    if ((plan.round_2_status && plan.round_2_status !== 'not_started') && (!timelineRound2 || timelineRound2.length < 4)) {
      await initApprovalTimeline(id, plan.teacher_name, plan.round_2_stage || 'dept_head', plan.round_2_status || 'submitted', 2);
      timelineRound2 = await db.query(
        `SELECT * FROM approval_timeline WHERE lesson_plan_id = ? AND round_number = 2 ORDER BY step_order ASC`,
        [id]
      );
    }

    res.json({
      success: true,
      data: {
        plan,
        timeline: timelineRound1,
        timeline_round_1: timelineRound1,
        timeline_round_2: timelineRound2,
        current_stage: plan.current_stage || 'dept_head',
        current_reviewer_title: plan.current_reviewer_title || 'หัวหน้ากลุ่มสาระการเรียนรู้',
        current_round: plan.current_round || 1,
        round_2_status: plan.round_2_status || 'not_started',
        round_2_stage: plan.round_2_stage || 'dept_head'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.2. Teacher Submit / Sign for Round 2
app.post('/api/plans/:id/submit-round-2', upload.single('pdf_file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { signature_data } = req.body;
    const plan = await db.get('SELECT * FROM lesson_plans WHERE id = ?', [id]);
    if (!plan) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลแผนการสอน' });

    let filePath = plan.local_file_path;
    if (req.file && req.file.path) {
      filePath = req.file.path;
    }

    await db.execute(
      `UPDATE lesson_plans 
       SET round_2_signature = ?,
           round_2_signed_at = CURRENT_TIMESTAMP,
           round_2_status = 'submitted',
           round_2_stage = 'dept_head',
           current_round = 2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [signature_data || null, id]
    );

    await initApprovalTimeline(id, plan.teacher_name, 'dept_head', 'submitted', 2);

    // Stamp Teacher signature into Column 2
    try {
      await pdfService.stampSignature({
        sourcePdfPath: filePath,
        signatureBase64: signature_data,
        planId: id,
        teacherName: plan.teacher_name,
        subjectCode: plan.subject_code,
        termName: 'Term',
        signedAt: new Date(),
        column: 2
      });
    } catch (stampErr) {
      console.warn('[Round 2 Teacher Stamp Error]:', stampErr.message);
    }

    res.json({
      success: true,
      message: 'ส่งและลงนามแผนการสอน ครั้งที่ 2 เรียบร้อยแล้ว ระบบส่งต่อให้หัวหน้ากลุ่มสาระฯ ตรวจสอบ'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.3. Multi-tier Step Review Action (Advance Workflow or Send Back for Revision)
// Supports Round 1 (Column 1) and Round 2 (Column 2)
app.post('/api/admin/plans/:id/step-review', async (req, res) => {
  try {
    const { id } = req.params;
    const { action, feedback, reviewer_name, reviewer_role, reviewer_signature, round } = req.body;
    const targetRound = parseInt(round, 10) === 2 ? 2 : 1;

    const plan = await db.get('SELECT * FROM lesson_plans WHERE id = ?', [id]);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'ไม่พบแผนการสอน' });
    }

    // Ensure Round 2 timeline is initialized if reviewing Round 2
    if (targetRound === 2) {
      const existingR2 = await db.query('SELECT id FROM approval_timeline WHERE lesson_plan_id = ? AND round_number = 2', [id]);
      if (!existingR2 || existingR2.length === 0) {
        await initApprovalTimeline(id, plan.teacher_name, plan.round_2_stage || 'dept_head', plan.round_2_status || 'under_review', 2);
      }
    }

    const currentStage = targetRound === 2 ? (plan.round_2_stage || 'dept_head') : (plan.current_stage || 'dept_head');
    const now = new Date().toISOString();
    const roundTimelineCondition = targetRound === 2 ? 'round_number = 2' : '(round_number = 1 OR round_number IS NULL)';

    if (action === 'approve') {
      const defaultFeedback = feedback || 'สามารถนำไปใช้ในการสอนได้';

      if (currentStage === 'dept_head') {
        // Advance to Level 2: หัวหน้างานหลักสูตร (curriculum_head)
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, action_at = ?, reviewer_signature = ? 
           WHERE lesson_plan_id = ? AND stage_key = 'dept_head' AND ${roundTimelineCondition}`,
          [reviewer_name || 'หัวหน้ากลุ่มสาระฯ', reviewer_role || 'หัวหน้ากลุ่มสาระฯ', defaultFeedback, now, reviewer_signature || null, id]
        );
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'in_progress' 
           WHERE lesson_plan_id = ? AND stage_key = 'curriculum_head' AND ${roundTimelineCondition}`,
          [id]
        );

        if (targetRound === 2) {
          await db.execute(
            `UPDATE lesson_plans 
             SET round_2_stage = 'curriculum_head', 
                 round_2_status = 'under_review',
                 current_round = 2,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [id]
          );
        } else {
          await db.execute(
            `UPDATE lesson_plans 
             SET current_stage = 'curriculum_head', 
                 current_reviewer_title = 'หัวหน้างานหลักสูตร',
                 submission_status = 'under_review',
                 reviewer_feedback = ?,
                 reviewed_by = ?,
                 reviewed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [defaultFeedback, reviewer_name || 'หัวหน้ากลุ่มสาระฯ', id]
          );
        }

        // Stamp into memo slot 2 (หัวหน้ากลุ่มสาระฯ)
        try {
          await pdfService.stampReviewerSignature({
            planId: id,
            stageKey: 'dept_head',
            signatureBase64: reviewer_signature,
            reviewerName: reviewer_name || 'หัวหน้ากลุ่มสาระฯ',
            reviewerRole: reviewer_role || 'หัวหน้ากลุ่มสาระฯ',
            feedback: defaultFeedback,
            signedAt: now,
            column: targetRound
          });
        } catch (pdfErr) {
          console.warn(`[StepReview] Stamp dept_head signature error (Round ${targetRound}):`, pdfErr.message);
        }
        return res.json({ success: true, message: `ลงความเห็นชอบครั้งที่ ${targetRound} เรียบร้อย ส่งต่อหัวหน้างานหลักสูตร`, nextStage: 'curriculum_head', round: targetRound });

      } else if (currentStage === 'curriculum_head') {
        // Advance to Level 3: รองผู้อำนวยการฝ่ายวิชาการ (academic_director)
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, action_at = ?, reviewer_signature = ? 
           WHERE lesson_plan_id = ? AND stage_key = 'curriculum_head' AND ${roundTimelineCondition}`,
          [reviewer_name || 'หัวหน้างานหลักสูตร', reviewer_role || 'หัวหน้างานหลักสูตร', defaultFeedback, now, reviewer_signature || null, id]
        );
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'in_progress' 
           WHERE lesson_plan_id = ? AND stage_key = 'academic_director' AND ${roundTimelineCondition}`,
          [id]
        );

        if (targetRound === 2) {
          await db.execute(
            `UPDATE lesson_plans 
             SET round_2_stage = 'academic_director', 
                 round_2_status = 'under_review',
                 current_round = 2,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [id]
          );
        } else {
          await db.execute(
            `UPDATE lesson_plans 
             SET current_stage = 'academic_director', 
                 current_reviewer_title = 'รองผู้อำนวยการฝ่ายวิชาการ',
                 submission_status = 'under_review',
                 reviewer_feedback = ?,
                 reviewed_by = ?,
                 reviewed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [defaultFeedback, reviewer_name || 'หัวหน้างานหลักสูตร', id]
          );
        }

        // Stamp into memo slot 3 (งานพัฒนาคุณภาพการจัดการเรียนการสอน) only if curriculum_head didn't already stamp it
        try {
          const currRows = await db.query(
            `SELECT reviewer_signature FROM approval_timeline WHERE lesson_plan_id = ? AND stage_key = 'curriculum_head' AND ${roundTimelineCondition} AND status = 'completed'`,
            [id]
          );
          const alreadyStamped = currRows && currRows.length > 0 && currRows[0].reviewer_signature;
          if (!alreadyStamped) {
            await pdfService.stampReviewerSignature({
              planId: id,
              stageKey: 'curriculum_head',
              signatureBase64: reviewer_signature,
              reviewerName: reviewer_name || 'หัวหน้างานหลักสูตร',
              reviewerRole: reviewer_role || 'หัวหน้างานหลักสูตร',
              feedback: defaultFeedback,
              signedAt: now,
              column: targetRound
            });
          }
        } catch (pdfErr) {
          console.warn(`[StepReview] Stamp curriculum_head signature error (Round ${targetRound}):`, pdfErr.message);
        }
        return res.json({ success: true, message: `ผ่านการตรวจสอบงานหลักสูตร ครั้งที่ ${targetRound} ส่งต่อรองผู้อำนวยการฝ่ายวิชาการ`, nextStage: 'academic_director', round: targetRound });

      } else if (currentStage === 'academic_head') {
        // Advance to Level 4: รองผู้อำนวยการฝ่ายวิชาการ (academic_director)
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, action_at = ?, reviewer_signature = ? 
           WHERE lesson_plan_id = ? AND stage_key = 'academic_director' AND ${roundTimelineCondition}`,
          [reviewer_name || 'หัวหน้ากลุ่มบริหารวิชาการ', reviewer_role || 'หัวหน้ากลุ่มบริหารวิชาการ', defaultFeedback, now, reviewer_signature || null, id]
        );
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'in_progress' 
           WHERE lesson_plan_id = ? AND stage_key = 'academic_director' AND ${roundTimelineCondition}`,
          [id]
        );

        if (targetRound === 2) {
          await db.execute(
            `UPDATE lesson_plans 
             SET round_2_stage = 'academic_director', 
                 round_2_status = 'under_review',
                 current_round = 2,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [id]
          );
        } else {
          await db.execute(
            `UPDATE lesson_plans 
             SET current_stage = 'academic_director', 
                 current_reviewer_title = 'รองผู้อำนวยการฝ่ายวิชาการ',
                 submission_status = 'under_review',
                 reviewer_feedback = ?,
                 reviewed_by = ?,
                 reviewed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [defaultFeedback, reviewer_name || 'หัวหน้ากลุ่มบริหารวิชาการ', id]
          );
        }

        // Stamp into memo slot 3 only if curriculum_head didn't already stamp it
        try {
          const currRows = await db.query(
            `SELECT reviewer_signature FROM approval_timeline WHERE lesson_plan_id = ? AND stage_key = 'curriculum_head' AND ${roundTimelineCondition} AND status = 'completed'`,
            [id]
          );
          const alreadyStamped = currRows && currRows.length > 0 && currRows[0].reviewer_signature;
          if (!alreadyStamped) {
            await pdfService.stampReviewerSignature({
              planId: id,
              stageKey: 'academic_head',
              signatureBase64: reviewer_signature,
              reviewerName: reviewer_name || 'หัวหน้ากลุ่มบริหารวิชาการ',
              reviewerRole: reviewer_role || 'หัวหน้ากลุ่มบริหารวิชาการ',
              feedback: defaultFeedback,
              signedAt: now,
              column: targetRound
            });
          }
        } catch (pdfErr) {
          console.warn(`[StepReview] Stamp academic_head signature error (Round ${targetRound}):`, pdfErr.message);
        }
        return res.json({ success: true, message: `ผ่านการตรวจสอบกลุ่มบริหารวิชาการ ครั้งที่ ${targetRound} ส่งต่อรองผู้อำนวยการฝ่ายวิชาการ`, nextStage: 'academic_director', round: targetRound });

      } else if (currentStage === 'academic_director') {
        // Advance to Level 5: ผู้อำนวยการโรงเรียน (director)
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, action_at = ?, reviewer_signature = ? 
           WHERE lesson_plan_id = ? AND stage_key = 'academic_director' AND ${roundTimelineCondition}`,
          [reviewer_name || 'ดร.ประสิทธิ์ ปัญญายิ่ง', reviewer_role || 'รองผู้อำนวยการฝ่ายวิชาการ', defaultFeedback, now, reviewer_signature || null, id]
        );
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'in_progress' 
           WHERE lesson_plan_id = ? AND stage_key = 'director' AND ${roundTimelineCondition}`,
          [id]
        );

        if (targetRound === 2) {
          await db.execute(
            `UPDATE lesson_plans 
             SET round_2_stage = 'director', 
                 round_2_status = 'under_review',
                 current_round = 2,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [id]
          );
        } else {
          await db.execute(
            `UPDATE lesson_plans 
             SET current_stage = 'director', 
                 current_reviewer_title = 'ผู้อำนวยการโรงเรียน',
                 submission_status = 'under_review',
                 reviewer_feedback = ?,
                 reviewed_by = ?,
                 reviewed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [defaultFeedback, reviewer_name || 'ดร.ประสิทธิ์ ปัญญายิ่ง', id]
          );
        }

        // Stamp into memo slot 4 (รองผู้อำนวยการฝ่ายวิชาการ + ความเห็น)
        try {
          await pdfService.stampReviewerSignature({
            planId: id,
            stageKey: 'academic_director',
            signatureBase64: reviewer_signature,
            reviewerName: reviewer_name || 'ดร.ประสิทธิ์ ปัญญายิ่ง',
            reviewerRole: reviewer_role || 'รองผู้อำนวยการฝ่ายวิชาการ',
            feedback: defaultFeedback,
            signedAt: now,
            column: targetRound
          });
        } catch (pdfErr) {
          console.warn(`[StepReview] Stamp academic_director signature error (Round ${targetRound}):`, pdfErr.message);
        }
        return res.json({ success: true, message: `ผ่านการกลั่นกรองวิชาการ ครั้งที่ ${targetRound} ส่งต่อผู้อำนวยการโรงเรียนพิจารณาอนุมัติ`, nextStage: 'director', round: targetRound });

      } else if (currentStage === 'director') {
        // Final Approval by Principal
        await db.execute(
          `UPDATE approval_timeline 
           SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, action_at = ?, reviewer_signature = ? 
           WHERE lesson_plan_id = ? AND stage_key = 'director' AND ${roundTimelineCondition}`,
          [reviewer_name || 'นางนิกูล ทองหน้าศาล', reviewer_role || 'ผู้อำนวยการโรงเรียน', defaultFeedback, now, reviewer_signature || null, id]
        );

        if (targetRound === 2) {
          await db.execute(
            `UPDATE lesson_plans 
             SET round_2_stage = 'completed', 
                 round_2_status = 'approved',
                 current_round = 2,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [id]
          );
        } else {
          await db.execute(
            `UPDATE lesson_plans 
             SET current_stage = 'completed', 
                 current_reviewer_title = 'อนุมัติเสร็จสมบูรณ์',
                 submission_status = 'approved',
                 reviewer_feedback = ?,
                 reviewed_by = ?,
                 reviewed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [defaultFeedback, reviewer_name || 'นางนิกูล ทองหน้าศาล', id]
          );
        }

        // Stamp into memo slot 5 (ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม)
        try {
          await pdfService.stampReviewerSignature({
            planId: id,
            stageKey: 'director',
            signatureBase64: reviewer_signature,
            reviewerName: reviewer_name || 'นางนิกูล ทองหน้าศาล',
            reviewerRole: reviewer_role || 'ผู้อำนวยการโรงเรียน',
            feedback: defaultFeedback,
            signedAt: now,
            column: targetRound
          });
        } catch (pdfErr) {
          console.warn(`[StepReview] Stamp director signature error (Round ${targetRound}):`, pdfErr.message);
        }
        return res.json({ success: true, message: `ผู้อำนวยการโรงเรียนอนุมัติแผนการสอน ครั้งที่ ${targetRound} เรียบร้อยแล้ว`, nextStage: 'completed', round: targetRound });
      }

    } else if (action === 'revision') {
      // Send back for revision
      await db.execute(
        `UPDATE approval_timeline 
         SET status = 'revision_needed', reviewer_name = ?, reviewer_role = ?, feedback = ?, action_at = ?, reviewer_signature = ? 
         WHERE lesson_plan_id = ? AND (stage_key = ? OR status = 'in_progress') AND ${roundTimelineCondition}`,
        [reviewer_name || 'ผู้ตรวจพิจารณา', reviewer_role || 'ผู้ตรวจ', feedback || 'ส่งกลับเพื่อแก้ไขปรับปรุง', now, reviewer_signature || null, id, currentStage]
      );

      if (targetRound === 2) {
        await db.execute(
          `UPDATE lesson_plans 
           SET round_2_status = 'revision_needed', 
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [id]
        );
      } else {
        await db.execute(
          `UPDATE lesson_plans 
           SET current_stage = 'revision_needed', 
               current_reviewer_title = ?, 
               submission_status = 'revision_needed', 
               reviewer_feedback = ?, 
               reviewed_by = ?, 
               reviewed_at = CURRENT_TIMESTAMP, 
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
          [`ส่งกลับแก้ไขโดย ${reviewer_role || 'ผู้ตรวจ'}`, feedback || 'ส่งกลับเพื่อแก้ไขปรับปรุง', reviewer_name || 'ผู้ตรวจ', id]
        );
      }

      return res.json({ success: true, message: `ส่งกลับแผนการสอน ครั้งที่ ${targetRound} ให้ครูผู้สอนปรับปรุงแก้ไขเรียบร้อยแล้ว`, round: targetRound });
    }
    return res.status(400).json({ success: false, message: 'คำสั่งไม่ถูกต้อง' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. View / Download Stamped Certified PDF
app.get('/api/files/download/:id', async (req, res) => {
  try {
    const plan = await db.get(`SELECT * FROM lesson_plans WHERE id = ?`, [req.params.id]);
    if (!plan) return res.status(404).send('ไม่พบไฟล์');

    // Ensure all recorded signatures are synced onto Page 2
    try {
      await pdfService.syncAllSignaturesToPage2(req.params.id);
    } catch (syncErr) {
      console.warn('[Download] syncAllSignaturesToPage2 error:', syncErr.message);
    }

    const targetPath = plan.stamped_file_path || plan.local_file_path;
    if (targetPath && fs.existsSync(targetPath)) {
      res.download(targetPath, `[Certified]_${plan.file_original_name || 'lesson_plan.pdf'}`);
    } else {
      res.status(404).send('ไม่พบไฟล์เอกสารบนเซิร์ฟเวอร์');
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/api/files/view-stamped/:id', async (req, res) => {
  try {
    const plan = await db.get(`SELECT * FROM lesson_plans WHERE id = ?`, [req.params.id]);
    if (!plan) return res.status(404).send('ไม่พบไฟล์');

    // Ensure all recorded signatures are synced onto Page 2
    try {
      await pdfService.syncAllSignaturesToPage2(req.params.id);
    } catch (syncErr) {
      console.warn('[ViewStamped] syncAllSignaturesToPage2 error:', syncErr.message);
    }

    const targetPath = plan.stamped_file_path || plan.local_file_path;
    if (targetPath && fs.existsSync(targetPath)) {
      res.contentType('application/pdf');
      fs.createReadStream(targetPath).pipe(res);
    } else {
      res.status(404).send('ไฟล์ยังประมวลผลไม่เสร็จ หรือไม่พบไฟล์');
    }
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Endpoint to manually or programmatically sync all signatures onto Page 2
app.post('/api/admin/plans/:id/sync-page2', async (req, res) => {
  try {
    const updatedPath = await pdfService.syncAllSignaturesToPage2(req.params.id);
    if (!updatedPath) {
      return res.status(404).json({ success: false, message: 'ไม่พบไฟล์ที่รับรองของแผนนี้' });
    }
    res.json({ success: true, message: 'ซิงค์ลายเซ็นทั้งหมดลงในหน้าที่ 2 เรียบร้อยแล้ว' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start Server & Database
async function startServer() {
  try {
    await initDatabase();
    
// -------------------------------------------------------------
// Google Drive Management & Sync Endpoints
// -------------------------------------------------------------
app.get('/api/admin/drive/status', async (req, res) => {
  try {
    const status = await googleDriveService.checkConnectionStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/drive/sync-folders', async (req, res) => {
  try {
    const departments = await db.query('SELECT * FROM departments ORDER BY name ASC');
    const users = await db.query('SELECT * FROM users ORDER BY name ASC');
    const result = await googleDriveService.syncAllFolders(departments, users);
    res.json({
      success: true,
      message: `ซิงค์โครงสร้างโฟลเดอร์สำเร็จ: สร้าง/ตรวจพบกลุ่มสาระฯ ${result.departmentsCreated} หมวด และครู ${result.teachersCreated} ท่าน`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
      console.log(`====================================================`);
      console.log(`🚀 School Lesson Plan Submission Portal active!`);
      console.log(`🌐 Server URL: http://localhost:${PORT} (or http://127.0.0.1:${PORT})`);
      console.log(`📁 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`====================================================`);
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

startServer();
