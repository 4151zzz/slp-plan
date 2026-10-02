<?php
/**
 * PHP Backend API Router for Lesson Plan Submission Portal
 * Developed by: wunPiyapong
 * Compatible with PHP 8.0+ / MySQL 5.7+ / MariaDB 10.3+
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

@ini_set('memory_limit', '512M');
@set_time_limit(300);

// Global Exception & Shutdown Handlers (Always return clean JSON)
set_exception_handler(function($e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
});

register_shutdown_function(function() {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => $err['message'] . ' in ' . basename($err['file']) . ' line ' . $err['line']], JSON_UNESCAPED_UNICODE);
    }
});

// -------------------------------------------------------------
// Database Connection
// -------------------------------------------------------------
function getDatabase() {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    // Load .env if available
    $envPath = __DIR__ . '/../../.env';
    $dbHost = 'localhost';
    $dbPort = '3306';
    $dbUser = 'saluangac_plan';
    $dbPass = 'wun426655';
    $dbName = 'saluangac_plan';

    if (file_exists($envPath)) {
        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (strpos(trim($line), '#') === 0) continue;
            if (strpos($line, '=') !== false) {
                list($key, $val) = explode('=', $line, 2);
                $key = trim($key);
                $val = trim($val, " \t\n\r\0\x0B\"'");
                if ($key === 'DB_HOST') $dbHost = $val;
                if ($key === 'DB_PORT') $dbPort = $val;
                if ($key === 'DB_USER') $dbUser = $val;
                if ($key === 'DB_PASSWORD') $dbPass = $val;
                if ($key === 'DB_NAME') $dbName = $val;
            }
        }
    }

    try {
        $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
        $pdo = new PDO($dsn, $dbUser, $dbPass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false
        ]);
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Database connection failed: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
function json_resp($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function get_json_body() {
    $raw = file_get_contents('php://input');
    if (empty($raw)) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function gen_uuid() {
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000,
        mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
    );
}

function ensure_dir($path) {
    if (!file_exists($path)) {
        @mkdir($path, 0755, true);
    }
}

// Timeline Helper (5 Approval Tiers)
function init_approval_timeline($pdo, $planId, $teacherName, $currentStage = 'dept_head', $submissionStatus = 'submitted', $roundNumber = 1) {
    $rNum = intval($roundNumber) === 2 ? 2 : 1;
    if ($rNum === 1) {
        $stmt = $pdo->prepare("DELETE FROM approval_timeline WHERE lesson_plan_id = ? AND (round_number = 1 OR round_number IS NULL)");
        $stmt->execute([$planId]);
    } else {
        $stmt = $pdo->prepare("DELETE FROM approval_timeline WHERE lesson_plan_id = ? AND round_number = 2");
        $stmt->execute([$planId]);
    }

    $roundLabel = $rNum === 2 ? ' (ครั้งที่ 2)' : '';
    $steps = [
        ['order' => 1, 'key' => 'dept_head', 'title' => "1. หัวหน้ากลุ่มสาระ{$roundLabel}", 'role' => 'หัวหน้ากลุ่มสาระฯ'],
        ['order' => 2, 'key' => 'curriculum_head', 'title' => "2. หัวหน้างานหลักสูตร{$roundLabel}", 'role' => 'หัวหน้างานหลักสูตร'],
        ['order' => 3, 'key' => 'academic_director', 'title' => "3. รองผู้อำนวยการฝ่ายวิชาการ{$roundLabel}", 'role' => 'รองผู้อำนวยการฝ่ายวิชาการ'],
        ['order' => 4, 'key' => 'director', 'title' => "4. ผู้อำนวยการ{$roundLabel}", 'role' => 'ผู้อำนวยการโรงเรียน']
    ];

    $stageOrderMap = [
        'dept_head' => 1,
        'curriculum_head' => 2,
        'academic_director' => 3,
        'director' => 4,
        'completed' => 5
    ];

    $activeOrder = $submissionStatus === 'approved' ? 5 : ($stageOrderMap[$currentStage] ?? 1);

    foreach ($steps as $s) {
        $status = 'waiting';
        $feedback = null;
        $reviewer = null;

        if ($submissionStatus === 'approved' || $s['order'] < $activeOrder) {
            $status = 'completed';
            $feedback = 'เห็นชอบตามเสนอ';
            $reviewer = $s['role'];
        } elseif ($s['order'] === $activeOrder) {
            if ($submissionStatus === 'revision_needed') {
                $status = 'revision_needed';
                $feedback = 'ส่งกลับเพื่อแก้ไขปรับปรุง';
            } else {
                $status = 'in_progress';
            }
        }

        $ins = $pdo->prepare("
            INSERT INTO approval_timeline (id, lesson_plan_id, step_order, stage_key, stage_title, reviewer_name, reviewer_role, status, feedback, action_at, round_number)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $ins->execute([
            gen_uuid(),
            $planId,
            $s['order'],
            $s['key'],
            $s['title'],
            $reviewer,
            $s['role'],
            $status,
            $feedback,
            $status === 'completed' ? date('Y-m-d H:i:s') : null,
            $rNum
        ]);
    }
}

// -------------------------------------------------------------
// Route Parsing
// -------------------------------------------------------------
$uri = $_SERVER['REQUEST_URI'];
$method = $_SERVER['REQUEST_METHOD'];

// Remove query string
if (($pos = strpos($uri, '?')) !== false) {
    $uri = substr($uri, 0, $pos);
}

// Extract path relative to /api
$apiPrefix = '/api';
$apiPos = strpos($uri, $apiPrefix);
if ($apiPos !== false) {
    $path = substr($uri, $apiPos + strlen($apiPrefix));
} else {
    // If accessed directly inside api/ folder
    $scriptName = dirname($_SERVER['SCRIPT_NAME']);
    $path = str_replace($scriptName, '', $uri);
}
$path = '/' . trim($path, '/');

$pdo = getDatabase();

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------

// 1. GET /api/auth/users
if ($method === 'GET' && $path === '/auth/users') {
    $stmt = $pdo->query("SELECT id, name, email, role, department, position_title, avatar FROM users ORDER BY role DESC");
    json_resp(['success' => true, 'data' => $stmt->fetchAll()]);
}

// 2. POST /api/auth/login
if ($method === 'POST' && $path === '/auth/login') {
    $body = get_json_body();
    $email = trim($body['email'] ?? '');
    $userId = trim($body['userId'] ?? '');
    $pin = trim($body['pin'] ?? '');

    $user = null;
    if ($userId) {
        $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $user = $stmt->fetch();
    } elseif ($email) {
        $cleanEmail = strtolower($email);
        $stmt = $pdo->prepare("SELECT * FROM users WHERE LOWER(email) = ?");
        $stmt->execute([$cleanEmail]);
        $user = $stmt->fetch();

        // Auto-provision teacher if email is from school
        if (!$user) {
            $id = 'u-' . substr(gen_uuid(), 0, 8);
            $parts = explode('@', $cleanEmail);
            $namePart = preg_replace('/[._]/', ' ', $parts[0]);
            $thaiName = "ครู{$namePart}";

            $ins = $pdo->prepare("
                INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) 
                VALUES (?, ?, ?, 'teacher', 'กลุ่มสาระการเรียนรู้ทั่วไป', 'ครูผู้สอน', '👨‍🏫', '1234')
            ");
            $ins->execute([$id, $thaiName, $cleanEmail]);

            $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
            $stmt->execute([$id]);
            $user = $stmt->fetch();
        }
    }

    if (!$user) {
        json_resp(['success' => false, 'message' => 'ไม่พบบัญชีผู้ใช้งานในระบบ'], 404);
    }

    // PIN Security Check for ALL users (teacher, dept_head, admin, etc.)
    $userPin = !empty($user['pin_code']) ? trim($user['pin_code']) : '1234';
    if (!empty($userPin)) {
        if (empty($pin)) {
            json_resp([
                'success' => false,
                'requirePin' => true,
                'role' => $user['role'],
                'name' => $user['name'],
                'position' => $user['position_title'],
                'department' => $user['department'],
                'message' => 'กรุณากรอกรหัส PIN 4 หลักเพื่อเข้าสู่ระบบ'
            ], 401);
        }

        if (trim($pin) !== $userPin) {
            json_resp([
                'success' => false,
                'requirePin' => true,
                'message' => 'รหัส PIN ไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง'
            ], 401);
        }
    }

    json_resp(['success' => true, 'user' => $user]);
}

// 3. GET /api/terms
if ($method === 'GET' && $path === '/terms') {
    $stmt = $pdo->query("SELECT * FROM academic_terms ORDER BY is_active DESC, created_at DESC");
    json_resp(['success' => true, 'data' => $stmt->fetchAll()]);
}

// 4. GET /api/departments
if ($method === 'GET' && $path === '/departments') {
    $stmt = $pdo->query("
        SELECT d.*, 
               (SELECT COUNT(*) FROM lesson_plans lp WHERE lp.teacher_department = d.name) as plan_count,
               (SELECT COUNT(*) FROM users u WHERE u.department = d.name) as teacher_count
        FROM departments d 
        ORDER BY d.created_at ASC
    ");
    json_resp(['success' => true, 'data' => $stmt->fetchAll()]);
}

// 5. POST /api/departments
if ($method === 'POST' && $path === '/departments') {
    $b = get_json_body();
    $name = trim($b['name'] ?? '');
    $code = strtolower(preg_replace('/[^a-z0-9_-]/', '', $b['code'] ?? ''));
    if (!$name || !$code) {
        json_resp(['success' => false, 'message' => 'กรุณาระบุชื่อกลุ่มสาระฯ และรหัสหมวด'], 400);
    }

    $chk = $pdo->prepare("SELECT id FROM departments WHERE LOWER(code) = ? OR LOWER(name) = ?");
    $chk->execute([$code, strtolower($name)]);
    if ($chk->fetch()) {
        json_resp(['success' => false, 'message' => 'มีรหัสหรือชื่อกลุ่มสาระการเรียนรู้นี้ในระบบแล้ว'], 409);
    }

    $id = 'dept-' . $code;
    $pin = $b['head_pin'] ? trim($b['head_pin']) : '1234';
    $cleanHeadEmail = !empty($b['head_email']) ? strtolower(trim($b['head_email'])) : null;
    $headName = !empty($b['head_name']) ? trim($b['head_name']) : null;

    $stmt = $pdo->prepare("INSERT INTO departments (id, code, name, head_name, head_email, head_pin, description) VALUES (?, ?, ?, ?, ?, ?, ?)");
    $stmt->execute([$id, $code, $name, $headName, $cleanHeadEmail, $pin, $b['description'] ?? '']);

    json_resp(['success' => true, 'message' => 'เพิ่มกลุ่มสาระการเรียนรู้เรียบร้อยแล้ว']);
}

// 6. PUT /api/departments/:id
if ($method === 'PUT' && preg_match('#^/departments/([^/]+)$#', $path, $matches)) {
    $deptId = $matches[1];
    $b = get_json_body();
    $name = trim($b['name'] ?? '');
    $headName = trim($b['head_name'] ?? '');
    $headEmail = trim($b['head_email'] ?? '');
    $pin = trim($b['head_pin'] ?? '1234');
    $desc = trim($b['description'] ?? '');

    $stmt = $pdo->prepare("UPDATE departments SET name = ?, head_name = ?, head_email = ?, head_pin = ?, description = ? WHERE id = ?");
    $stmt->execute([$name, $headName, $headEmail, $pin, $desc, $deptId]);

    // If head email is set, sync or create user
    if ($headEmail) {
        $uChk = $pdo->prepare("SELECT id FROM users WHERE LOWER(email) = ?");
        $uChk->execute([strtolower($headEmail)]);
        $uRow = $uChk->fetch();
        if ($uRow) {
            $uUpd = $pdo->prepare("UPDATE users SET name = ?, role = 'dept_head', department = ?, position_title = ?, pin_code = ? WHERE id = ?");
            $uUpd->execute([$headName, $name, "หัวหน้ากลุ่มสาระฯ {$name}", $pin, $uRow['id']]);
        } else {
            $uId = 'u-head-' . substr(gen_uuid(), 0, 8);
            $uIns = $pdo->prepare("INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) VALUES (?, ?, ?, 'dept_head', ?, ?, '👩‍💼', ?)");
            $uIns->execute([$uId, $headName, strtolower($headEmail), $name, "หัวหน้ากลุ่มสาระฯ {$name}", $pin]);
        }
    }

    json_resp(['success' => true, 'message' => 'อัปเดตข้อมูลกลุ่มสาระฯ สำเร็จ']);
}

// 7. DELETE /api/departments/:id
if ($method === 'DELETE' && preg_match('#^/departments/([^/]+)$#', $path, $matches)) {
    $stmt = $pdo->prepare("DELETE FROM departments WHERE id = ?");
    $stmt->execute([$matches[1]]);
    json_resp(['success' => true, 'message' => 'ลบกลุ่มสาระการเรียนรู้เรียบร้อยแล้ว']);
}

// 7.1 PUT /api/departments/:id/reset-pin
if ($method === 'PUT' && preg_match('#^/departments/([^/]+)/reset-pin$#', $path, $matches)) {
    $dId = $matches[1];
    $b = get_json_body();
    $pin = trim($b['pin'] ?? '1234');
    if (strlen($pin) !== 4) $pin = '1234';

    $dStmt = $pdo->prepare("SELECT * FROM departments WHERE id = ?");
    $dStmt->execute([$dId]);
    $dept = $dStmt->fetch();
    if (!$dept) {
        json_resp(['success' => false, 'message' => 'ไม่พบกลุ่มสาระฯ นี้ในระบบ'], 404);
    }

    $upd = $pdo->prepare("UPDATE departments SET head_pin = ? WHERE id = ?");
    $upd->execute([$pin, $dId]);

    if (!empty($dept['head_email'])) {
        $uUpd = $pdo->prepare("UPDATE users SET pin_code = ? WHERE LOWER(email) = ?");
        $uUpd->execute([$pin, strtolower($dept['head_email'])]);
    }

    json_resp([
        'success' => true,
        'message' => "รีเซ็ตรหัส PIN ของหัวหน้ากลุ่มสาระฯ {$dept['name']} เป็น \"{$pin}\" เรียบร้อยแล้ว",
        'newPin' => $pin
    ]);
}

// 8. GET /api/plans/check-duplicate
if ($method === 'GET' && $path === '/plans/check-duplicate') {
    $email = strtolower(trim($_GET['email'] ?? ''));
    $termId = trim($_GET['term_id'] ?? '');

    if (!$email || !$termId) {
        json_resp(['exists' => false, 'canEdit' => true]);
    }

    $stmt = $pdo->prepare("
        SELECT lp.*, at.name as term_name 
        FROM lesson_plans lp
        LEFT JOIN academic_terms at ON lp.academic_term_id = at.id
        WHERE LOWER(lp.teacher_email) = ? AND lp.academic_term_id = ?
        LIMIT 1
    ");
    $stmt->execute([$email, $termId]);
    $existing = $stmt->fetch();

    if ($existing) {
        $canEdit = in_array($existing['submission_status'], ['draft', 'revision_needed', 'submitted']);
        json_resp([
            'exists' => true,
            'canEdit' => $canEdit,
            'status' => $existing['submission_status'],
            'message' => $canEdit 
                ? 'คุณมีแผนการสอนในภาคเรียนนี้แล้ว (สามารถแก้ไขหรือส่งฉบับปรับปรุงได้)'
                : 'คุณได้ส่งแผนการสอนสำหรับภาคเรียนนี้ไปแล้ว',
            'plan' => [
                'id' => $existing['id'],
                'subject_code' => $existing['subject_code'],
                'subject_name' => $existing['subject_name'],
                'submission_status' => $existing['submission_status'],
                'created_at' => $existing['created_at'],
                'reviewer_feedback' => $existing['reviewer_feedback'],
                'google_drive_view_link' => $existing['google_drive_view_link']
            ]
        ]);
    } else {
        json_resp(['exists' => false, 'canEdit' => true]);
    }
}

// 9. POST /api/plans/submit (Upload Lesson Plan)
if ($method === 'POST' && $path === '/plans/submit') {
    @set_time_limit(120);
    $planId = gen_uuid();
    $termId = trim($_POST['academic_term_id'] ?? '');
    $teacherName = trim($_POST['teacher_name'] ?? '');
    $teacherEmail = strtolower(trim($_POST['teacher_email'] ?? ''));
    $teacherDept = trim($_POST['teacher_department'] ?? '');
    $subjectCode = strtoupper(trim($_POST['subject_code'] ?? ''));
    $subjectName = trim($_POST['subject_name'] ?? '');
    $gradeLevel = trim($_POST['grade_level'] ?? '');
    $signatureData = $_POST['signature_data'] ?? null;

    if (!$termId || !$teacherName || !$teacherEmail || !$subjectCode || !$subjectName) {
        json_resp(['success' => false, 'message' => 'กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง'], 400);
    }

    // Check duplicate: 1 teacher can submit 1 plan per academic term
    $chk = $pdo->prepare("SELECT * FROM lesson_plans WHERE LOWER(teacher_email) = ? AND academic_term_id = ?");
    $chk->execute([$teacherEmail, $termId]);
    $existingPlan = $chk->fetch();
    if ($existingPlan) {
        $canEdit = in_array($existingPlan['submission_status'], ['submitted', 'revision_needed', 'draft']);
        json_resp([
            'success' => false,
            'message' => 'คุณได้ส่งแผนการสอนสำหรับภาคเรียนนี้ไปแล้ว',
            'canEdit' => $canEdit,
            'existingPlan' => [
                'id' => $existingPlan['id'],
                'subject_code' => $existingPlan['subject_code'],
                'subject_name' => $existingPlan['subject_name'],
                'submission_status' => $existingPlan['submission_status'],
                'created_at' => $existingPlan['created_at'],
                'reviewer_feedback' => $existingPlan['reviewer_feedback'],
                'google_drive_view_link' => $existingPlan['google_drive_view_link']
            ]
        ], 409);
    }

    // File handling
    $uploadDir = __DIR__ . '/../../data/uploads';
    ensure_dir($uploadDir);

    $originalName = '';
    $fileSize = 0;
    $localFilePath = '';
    $destPath = '';

    if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['pdf_file'];
        $originalName = $file['name'];
        $fileSize = $file['size'];
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        if ($ext !== 'pdf') {
            json_resp(['success' => false, 'message' => 'รองรับเฉพาะไฟล์ PDF เท่านั้น'], 400);
        }

        $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
        $destPath = $uploadDir . '/' . $uniqueFileName;
        move_uploaded_file($file['tmp_name'], $destPath);
        $localFilePath = 'data/uploads/' . $uniqueFileName;
    } else {
        json_resp(['success' => false, 'message' => 'กรุณาแนบไฟล์แผนการสอน (PDF)'], 400);
    }

    // Google Drive Upload: Priority 1 - Google Apps Script Web App (Instant, Auto-organized folders, Unlimited quota)
    $driveFileId = null;
    $driveViewLink = null;
    $driveDownloadLink = null;
    try {
        $driveRes = uploadViaGoogleScript($destPath, $originalName, $teacherDept, $teacherName);
        if ($driveRes) {
            $driveFileId = $driveRes['fileId'];
            $driveViewLink = $driveRes['webViewLink'];
            $driveDownloadLink = $driveRes['downloadLink'];
        } else {
            // Fallback: Service Account if Web App not reachable
            $token = getGoogleAccessToken();
            if ($token) {
                $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
                $driveRes = uploadFileToGoogleDrive($token, $destPath, $originalName, $rootFolderId, $teacherDept, $teacherName);
                if ($driveRes) {
                    $driveFileId = $driveRes['fileId'];
                    $driveViewLink = $driveRes['webViewLink'];
                    $driveDownloadLink = $driveRes['downloadLink'];
                }
            }
        }
    } catch (Exception $e) {
        // Continue even if Drive fails so local record is not lost
    }

    $stmt = $pdo->prepare("
        INSERT INTO lesson_plans (
            id, academic_term_id, teacher_name, teacher_email, teacher_department, 
            subject_code, subject_name, grade_level, file_original_name, file_size, 
            local_file_path, google_drive_file_id, google_drive_view_link, google_drive_download_link,
            signature_data, signed_at, submission_status, current_stage, 
            current_reviewer_title, submission_round, current_round
        ) VALUES (
            ?, ?, ?, ?, ?, 
            ?, ?, ?, ?, ?, 
            ?, ?, ?, ?,
            ?, NOW(), 'submitted', 'dept_head', 
            'หัวหน้ากลุ่มสาระการเรียนรู้', 1, 1
        )
    ");
    $stmt->execute([
        $planId, $termId, $teacherName, $teacherEmail, $teacherDept,
        $subjectCode, $subjectName, $gradeLevel, $originalName, $fileSize,
        $localFilePath, $driveFileId, $driveViewLink, $driveDownloadLink,
        $signatureData
    ]);

    // Init 5-tier approval timeline
    init_approval_timeline($pdo, $planId, $teacherName, 'dept_head', 'submitted', 1);

    json_resp([
        'success' => true,
        'message' => 'ส่งแผนการสอนสำเร็จ ระบบได้บันทึกข้อมูลและนำส่ง Google Drive เรียบร้อยแล้ว',
        'planId' => $planId,
        'driveViewLink' => $driveViewLink
    ], 201);
}


// 9.1 PUT or POST /api/plans/:id (Update / Edit Existing Plan)
if (($method === 'PUT' || $method === 'POST') && preg_match('#^/plans/([^/]+)$#', $path, $matches) && !in_array($matches[1], ['check-duplicate', 'submit'])) {
    $planId = $matches[1];
    $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $stmt->execute([$planId]);
    $existing = $stmt->fetch();
    if (!$existing) {
        json_resp(['success' => false, 'message' => 'ไม่พบข้อมูลแผนการสอนที่ต้องการแก้ไข'], 404);
    }

    if (!in_array($existing['submission_status'], ['submitted', 'revision_needed', 'draft'])) {
        json_resp([
            'success' => false,
            'message' => "ไม่สามารถแก้ไขได้เนื่องจากสถานะปัจจุบันคือ \"{$existing['submission_status']}\""
        ], 403);
    }

    $tName = trim($_POST['teacher_name'] ?? $existing['teacher_name']);
    $tDept = trim($_POST['teacher_department'] ?? $existing['teacher_department']);
    $sCode = strtoupper(trim($_POST['subject_code'] ?? $existing['subject_code']));
    $sName = trim($_POST['subject_name'] ?? $existing['subject_name']);
    $gLevel = trim($_POST['grade_level'] ?? $existing['grade_level']);
    $sigData = $_POST['signature_data'] ?? $existing['signature_data'];

    $localFilePath = $existing['local_file_path'];
    $originalName = $existing['file_original_name'];
    $fileSize = $existing['file_size'];
    $driveFileId = $existing['google_drive_file_id'];
    $driveViewLink = $existing['google_drive_view_link'];
    $driveDownloadLink = $existing['google_drive_download_link'];

    if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['pdf_file'];
        $originalName = $file['name'];
        $fileSize = $file['size'];
        $uploadDir = __DIR__ . '/../../data/uploads';
        ensure_dir($uploadDir);

        $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
        $destPath = $uploadDir . '/' . $uniqueFileName;
        move_uploaded_file($file['tmp_name'], $destPath);
        $localFilePath = 'data/uploads/' . $uniqueFileName;

        // Delete old files if replacing
        $oldLocal = $existing['local_file_path'];
        $oldStamped = $existing['stamped_file_path'] ?? null;
        $oldDriveId = $existing['google_drive_file_id'];

        if (!empty($oldLocal) && $oldLocal !== $localFilePath) {
            $f1 = __DIR__ . '/../../' . ltrim($oldLocal, '/');
            if (file_exists($f1) && is_file($f1)) @unlink($f1);
        }
        if (!empty($oldStamped) && $oldStamped !== $localFilePath && $oldStamped !== $oldLocal) {
            $f2 = __DIR__ . '/../../' . ltrim($oldStamped, '/');
            if (file_exists($f2) && is_file($f2)) @unlink($f2);
        }
        if (!empty($oldDriveId)) {
            deleteGoogleDriveFile($oldDriveId);
        }

        // Upload new file to Google Drive via Google Apps Script Web App
        try {
            $driveRes = uploadViaGoogleScript($destPath, $originalName, $tDept, $tName, $oldDriveId);
            if ($driveRes) {
                $driveFileId = $driveRes['fileId'];
                $driveViewLink = $driveRes['webViewLink'];
                $driveDownloadLink = $driveRes['downloadLink'];
            } else {
                $token = getGoogleAccessToken();
                if ($token) {
                    $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
                    $driveRes = uploadFileToGoogleDrive($token, $destPath, $originalName, $rootFolderId, $tDept, $tName);
                    if ($driveRes) {
                        $driveFileId = $driveRes['fileId'];
                        $driveViewLink = $driveRes['webViewLink'];
                        $driveDownloadLink = $driveRes['downloadLink'];
                    }
                }
            }
        } catch (Exception $e) {}
    }

    $upd = $pdo->prepare("
        UPDATE lesson_plans 
        SET teacher_name = ?,
            teacher_department = ?,
            subject_code = ?,
            subject_name = ?,
            grade_level = ?,
            file_original_name = ?,
            file_size = ?,
            local_file_path = ?,
            google_drive_file_id = ?,
            google_drive_view_link = ?,
            google_drive_download_link = ?,
            signature_data = ?,
            submission_status = 'submitted',
            current_stage = 'dept_head',
            current_reviewer_title = 'หัวหน้ากลุ่มสาระการเรียนรู้',
            reviewer_feedback = NULL,
            updated_at = NOW()
        WHERE id = ?
    ");
    $upd->execute([
        $tName, $tDept, $sCode, $sName, $gLevel,
        $originalName, $fileSize, $localFilePath,
        $driveFileId, $driveViewLink, $driveDownloadLink,
        $sigData, $planId
    ]);

    init_approval_timeline($pdo, $planId, $tName, 'dept_head', 'submitted', 1);

    json_resp([
        'success' => true,
        'message' => 'อัปเดตและส่งแผนการสอนฉบับปรับปรุงเรียบร้อยแล้ว',
        'planId' => $planId,
        'driveViewLink' => $driveViewLink
    ]);
}

// 10. GET /api/plans/teacher/:email
if ($method === 'GET' && preg_match('#^/plans/teacher/([^/]+)$#', $path, $matches)) {
    $email = strtolower(urldecode($matches[1]));
    $stmt = $pdo->prepare("
        SELECT lp.*, at.name as term_name, at.code as term_code 
        FROM lesson_plans lp
        LEFT JOIN academic_terms at ON lp.academic_term_id = at.id
        WHERE LOWER(lp.teacher_email) = ?
        ORDER BY lp.created_at DESC
    ");
    $stmt->execute([$email]);
    json_resp(['success' => true, 'data' => $stmt->fetchAll()]);
}

// 11. GET /api/plans/:id
if ($method === 'GET' && preg_match('#^/plans/([^/]+)$#', $path, $matches) && !in_array($matches[1], ['check-duplicate', 'submit'])) {
    $planId = $matches[1];
    $stmt = $pdo->prepare("
        SELECT lp.*, at.name as term_name, at.code as term_code 
        FROM lesson_plans lp
        LEFT JOIN academic_terms at ON lp.academic_term_id = at.id
        WHERE lp.id = ?
    ");
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) json_resp(['success' => false, 'message' => 'ไม่พบข้อมูลแผนการสอน'], 404);
    json_resp(['success' => true, 'data' => $plan]);
}

// 12. GET /api/plans/:id/timeline
if ($method === 'GET' && preg_match('#^/plans/([^/]+)/timeline$#', $path, $matches)) {
    $planId = $matches[1];
    $stmt = $pdo->prepare("
        SELECT lp.*, at.name as term_name, at.code as term_code 
        FROM lesson_plans lp
        LEFT JOIN academic_terms at ON lp.academic_term_id = at.id
        WHERE lp.id = ?
    ");
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) {
        json_resp(['success' => false, 'message' => 'ไม่พบข้อมูลแผนการสอน'], 404);
    }

    $t1Stmt = $pdo->prepare("
        SELECT * FROM approval_timeline 
        WHERE lesson_plan_id = ? AND (round_number = 1 OR round_number IS NULL)
        ORDER BY step_order ASC
    ");
    $t1Stmt->execute([$planId]);
    $timelineRound1 = $t1Stmt->fetchAll();

    // If timeline doesn't exist yet or is not 5 steps, initialize it on the fly
    if (empty($timelineRound1) || count($timelineRound1) !== 5) {
        init_approval_timeline($pdo, $planId, $plan['teacher_name'] ?? 'ครูผู้สอน', $plan['current_stage'] ?? 'dept_head', $plan['submission_status'] ?? 'submitted', 1);
        $t1Stmt->execute([$planId]);
        $timelineRound1 = $t1Stmt->fetchAll();
    }

    $t2Stmt = $pdo->prepare("
        SELECT * FROM approval_timeline 
        WHERE lesson_plan_id = ? AND round_number = 2
        ORDER BY step_order ASC
    ");
    $t2Stmt->execute([$planId]);
    $timelineRound2 = $t2Stmt->fetchAll();

    if ((!empty($plan['round_2_status']) && $plan['round_2_status'] !== 'not_started') && empty($timelineRound2)) {
        init_approval_timeline($pdo, $planId, $plan['teacher_name'] ?? 'ครูผู้สอน', $plan['round_2_stage'] ?? 'dept_head', $plan['round_2_status'] ?? 'submitted', 2);
        $t2Stmt->execute([$planId]);
        $timelineRound2 = $t2Stmt->fetchAll();
    }

    json_resp([
        'success' => true,
        'data' => [
            'plan' => $plan,
            'timeline' => $timelineRound1,
            'timeline_round_1' => $timelineRound1,
            'timeline_round_2' => $timelineRound2,
            'current_stage' => $plan['current_stage'] ?? 'dept_head',
            'current_reviewer_title' => $plan['current_reviewer_title'] ?? 'หัวหน้ากลุ่มสาระการเรียนรู้',
            'current_round' => $plan['current_round'] ?? 1,
            'round_2_status' => $plan['round_2_status'] ?? 'not_started',
            'round_2_stage' => $plan['round_2_stage'] ?? 'dept_head'
        ]
    ]);
}

// 13. POST /api/plans/:id/submit-round-2
if ($method === 'POST' && preg_match('#^/plans/([^/]+)/submit-round-2$#', $path, $matches)) {
    $planId = $matches[1];
    $sig2 = $_POST['signature_data'] ?? null;
    $stmt = $pdo->prepare("UPDATE lesson_plans SET round_2_signature = ?, round_2_signed_at = NOW(), round_2_status = 'submitted', round_2_stage = 'dept_head', current_round = 2 WHERE id = ?");
    $stmt->execute([$sig2, $planId]);

    $pStmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $pStmt->execute([$planId]);
    $p = $pStmt->fetch();

    if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['pdf_file'];
        $uploadDir = __DIR__ . '/../../data/uploads';
        ensure_dir($uploadDir);

        $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
        $destPath = $uploadDir . '/' . $uniqueFileName;
        move_uploaded_file($file['tmp_name'], $destPath);
        $newLocalPath = 'data/uploads/' . $uniqueFileName;

        if (!empty($p['local_file_path']) && $p['local_file_path'] !== $newLocalPath) {
            $f1 = __DIR__ . '/../../' . ltrim($p['local_file_path'], '/');
            if (file_exists($f1) && is_file($f1)) @unlink($f1);
        }
        if (!empty($p['google_drive_file_id'])) {
            deleteGoogleDriveFile($p['google_drive_file_id']);
        }

        try {
            $driveRes = uploadViaGoogleScript($destPath, $p['file_original_name'] ?: 'lesson_plan.pdf', $p['teacher_department'] ?: 'ทั่วไป', $p['teacher_name'] ?: 'ครูผู้สอน', $p['google_drive_file_id'] ?? null);
            if ($driveRes) {
                $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ?, google_drive_file_id = ?, google_drive_view_link = ?, google_drive_download_link = ? WHERE id = ?");
                $upd->execute([$newLocalPath, $newLocalPath, $driveRes['fileId'], $driveRes['webViewLink'], $driveRes['downloadLink'], $planId]);
            } else {
                $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ? WHERE id = ?");
                $upd->execute([$newLocalPath, $newLocalPath, $planId]);
            }
        } catch (Exception $e) {}
    }

    init_approval_timeline($pdo, $planId, $p['teacher_name'] ?? 'ครูผู้สอน', 'dept_head', 'submitted', 2);
    json_resp(['success' => true, 'message' => 'บันทึกการส่งและลงนามครั้งที่ 2 สำเร็จ']);
}

// 14. GET /api/admin/plans (Reviewer Dashboard List)
if ($method === 'GET' && $path === '/admin/plans') {
    $stage = $_GET['stage'] ?? null;
    $dept = $_GET['department'] ?? null;
    $term = $_GET['term'] ?? null;
    $search = $_GET['search'] ?? null;

    $sql = "
        SELECT lp.*, at.name as term_name, at.code as term_code 
        FROM lesson_plans lp
        LEFT JOIN academic_terms at ON lp.academic_term_id = at.id
        WHERE 1=1
    ";
    $params = [];

    if ($stage && $stage !== 'all') {
        $sql .= " AND lp.current_stage = ?";
        $params[] = $stage;
    }
    if ($dept && $dept !== 'all') {
        $sql .= " AND lp.teacher_department = ?";
        $params[] = $dept;
    }
    if ($term && $term !== 'all') {
        $sql .= " AND lp.academic_term_id = ?";
        $params[] = $term;
    }
    if ($search) {
        $sql .= " AND (lp.teacher_name LIKE ? OR lp.subject_name LIKE ? OR lp.subject_code LIKE ?)";
        $sTerm = "%{$search}%";
        $params[] = $sTerm;
        $params[] = $sTerm;
        $params[] = $sTerm;
    }

    $sql .= " ORDER BY lp.created_at DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    json_resp(['success' => true, 'data' => $stmt->fetchAll()]);
}

// 15. POST /api/admin/plans/:id/step-review (Tier progression)
if ($method === 'POST' && preg_match('#^/admin/plans/([^/]+)/step-review$#', $path, $matches)) {
    $planId = $matches[1];
    $b = get_json_body();
    $action = $_POST['action'] ?? $b['action'] ?? 'approve'; // approve / request_revision
    $feedback = trim($_POST['feedback'] ?? $b['feedback'] ?? '');
    $stageKey = trim($_POST['stageKey'] ?? $b['stageKey'] ?? '');
    $reviewerName = trim($_POST['reviewer_name'] ?? $_POST['reviewerName'] ?? $b['reviewerName'] ?? $b['reviewer_name'] ?? '');
    $reviewerRole = trim($_POST['reviewer_role'] ?? $_POST['reviewerRole'] ?? $b['reviewerRole'] ?? $b['reviewer_role'] ?? '');
    $roundNumber = intval($_POST['round'] ?? $_POST['roundNumber'] ?? $b['roundNumber'] ?? $b['round'] ?? 1);
    $reviewerSignature = $_POST['reviewer_signature'] ?? $_POST['reviewerSignature'] ?? $b['reviewer_signature'] ?? $b['reviewerSignature'] ?? null;

    $nextStageMap = [
        'dept_head' => 'curriculum_head',
        'curriculum_head' => 'academic_director',
        'academic_director' => 'director',
        'director' => 'completed'
    ];

    $titleMap = [
        'curriculum_head' => 'หัวหน้างานหลักสูตร',
        'academic_director' => 'รองผู้อำนวยการฝ่ายวิชาการ',
        'director' => 'ผู้อำนวยการโรงเรียน',
        'completed' => 'อนุมัติเรียบร้อย'
    ];

    // If an updated stamped PDF was attached by client-side PDFLib
    if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['pdf_file'];
        $uploadDir = __DIR__ . '/../../data/uploads';
        ensure_dir($uploadDir);

        $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
        $destPath = $uploadDir . '/' . $uniqueFileName;
        move_uploaded_file($file['tmp_name'], $destPath);
        $newLocalPath = 'data/uploads/' . $uniqueFileName;

        // Fetch plan details for Google Drive sync & file cleanup
        $pDetailsStmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
        $pDetailsStmt->execute([$planId]);
        $pDetails = $pDetailsStmt->fetch();

        $origName = $pDetails['file_original_name'] ?: 'lesson_plan.pdf';
        $tDept = $pDetails['teacher_department'] ?: 'ทั่วไป';
        $tName = $pDetails['teacher_name'] ?: 'ครูผู้สอน';
        $oldLocalPath = $pDetails['local_file_path'] ?? null;
        $oldStampedPath = $pDetails['stamped_file_path'] ?? null;
        $oldDriveId = $pDetails['google_drive_file_id'] ?? null;

        // 1. Delete previous local files so server storage does not accumulate old versions
        if (!empty($oldLocalPath) && $oldLocalPath !== $newLocalPath) {
            $f1 = __DIR__ . '/../../' . ltrim($oldLocalPath, '/');
            if (file_exists($f1) && is_file($f1)) @unlink($f1);
        }
        if (!empty($oldStampedPath) && $oldStampedPath !== $newLocalPath && $oldStampedPath !== $oldLocalPath) {
            $f2 = __DIR__ . '/../../' . ltrim($oldStampedPath, '/');
            if (file_exists($f2) && is_file($f2)) @unlink($f2);
        }

        // 2. Delete previous file on Google Drive so it doesn't accumulate
        if (!empty($oldDriveId)) {
            deleteGoogleDriveFile($oldDriveId);
        }

        try {
            $driveRes = uploadViaGoogleScript($destPath, $origName, $tDept, $tName, $oldDriveId);
            if ($driveRes) {
                $driveFileId = $driveRes['fileId'];
                $driveViewLink = $driveRes['webViewLink'];
                $driveDownloadLink = $driveRes['downloadLink'];

                $updDrive = $pdo->prepare("
                    UPDATE lesson_plans 
                    SET stamped_file_path = ?, local_file_path = ?, google_drive_file_id = ?, google_drive_view_link = ?, google_drive_download_link = ? 
                    WHERE id = ?
                ");
                $updDrive->execute([$newLocalPath, $newLocalPath, $driveFileId, $driveViewLink, $driveDownloadLink, $planId]);
            } else {
                $updLocal = $pdo->prepare("UPDATE lesson_plans SET stamped_file_path = ?, local_file_path = ? WHERE id = ?");
                $updLocal->execute([$newLocalPath, $newLocalPath, $planId]);
            }
        } catch (Exception $e) {
            $updLocal = $pdo->prepare("UPDATE lesson_plans SET stamped_file_path = ?, local_file_path = ? WHERE id = ?");
            $updLocal->execute([$newLocalPath, $newLocalPath, $planId]);
        }
    }

    if ($action === 'approve') {
        $nextStage = $nextStageMap[$stageKey] ?? 'completed';
        $subStatus = $nextStage === 'completed' ? 'approved' : 'under_review';
        $nextTitle = $titleMap[$nextStage] ?? '';

        // Update timeline step
        $updStep = $pdo->prepare("
            UPDATE approval_timeline 
            SET status = 'completed', feedback = ?, reviewer_name = ?, reviewer_signature = COALESCE(?, reviewer_signature), action_at = NOW() 
            WHERE lesson_plan_id = ? AND stage_key = ? AND (round_number = ? OR (? = 1 AND round_number IS NULL))
        ");
        $updStep->execute([$feedback ?: 'เห็นชอบตามเสนอ', $reviewerName, $reviewerSignature, $planId, $stageKey, $roundNumber, $roundNumber]);

        // If next step exists, set it to in_progress
        if ($nextStage !== 'completed') {
            $updNext = $pdo->prepare("
                UPDATE approval_timeline 
                SET status = 'in_progress' 
                WHERE lesson_plan_id = ? AND stage_key = ? AND (round_number = ? OR (? = 1 AND round_number IS NULL))
            ");
            $updNext->execute([$planId, $nextStage, $roundNumber, $roundNumber]);
        }

        // Update plan
        if ($roundNumber === 2) {
            $updPlan = $pdo->prepare("UPDATE lesson_plans SET round_2_stage = ?, round_2_status = ? WHERE id = ?");
            $updPlan->execute([$nextStage, $subStatus, $planId]);
        } else {
            $updPlan = $pdo->prepare("
                UPDATE lesson_plans 
                SET current_stage = ?, submission_status = ?, current_reviewer_title = ?, reviewer_feedback = ?, reviewed_at = NOW(), reviewed_by = ? 
                WHERE id = ?
            ");
            $updPlan->execute([$nextStage, $subStatus, $nextTitle, $feedback, $reviewerName, $planId]);
        }

        json_resp(['success' => true, 'message' => 'บันทึกการตรวจ ประทับตราลายเซ็นลงเอกสาร และส่งต่อไปยังระดับถัดไปเรียบร้อย']);
    } else {
        // Revision Needed
        $updStep = $pdo->prepare("
            UPDATE approval_timeline 
            SET status = 'revision_needed', feedback = ?, reviewer_name = ?, reviewer_signature = COALESCE(?, reviewer_signature), action_at = NOW() 
            WHERE lesson_plan_id = ? AND stage_key = ? AND (round_number = ? OR (? = 1 AND round_number IS NULL))
        ");
        $updStep->execute([$feedback ?: 'ส่งกลับเพื่อแก้ไข', $reviewerName, $reviewerSignature, $planId, $stageKey, $roundNumber, $roundNumber]);

        $updPlan = $pdo->prepare("
            UPDATE lesson_plans 
            SET submission_status = 'revision_needed', reviewer_feedback = ?, reviewed_at = NOW(), reviewed_by = ? 
            WHERE id = ?
        ");
        $updPlan->execute([$feedback, $reviewerName, $planId]);

        json_resp(['success' => true, 'message' => 'ส่งกลับแผนการสอนเพื่อแก้ไขปรับปรุงเรียบร้อย']);
    }
}

// 16. GET /api/admin/users-list
if ($method === 'GET' && $path === '/admin/users-list') {
    $stmt = $pdo->query("
        SELECT id, name, email, role, department, position_title, avatar, pin_code 
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
          END, department ASC, name ASC
    ");
    json_resp(['success' => true, 'data' => $stmt->fetchAll()]);
}

// 17. POST /api/admin/users
if ($method === 'POST' && $path === '/admin/users') {
    $b = get_json_body();
    $name = trim($b['name'] ?? '');
    $email = strtolower(trim($b['email'] ?? ''));
    $role = trim($b['role'] ?? 'teacher');
    $dept = trim($b['department'] ?? 'กลุ่มสาระการเรียนรู้ทั่วไป');
    $pos = trim($b['position_title'] ?? 'ครูผู้สอน');
    $pin = trim($b['pin_code'] ?? '1234');
    $avatar = $b['avatar'] ?? '👨‍🏫';

    if (!$name || !$email) {
        json_resp(['success' => false, 'message' => 'กรุณากรอกชื่อและอีเมลให้ครบ'], 400);
    }

    $chk = $pdo->prepare("SELECT id FROM users WHERE LOWER(email) = ?");
    $chk->execute([$email]);
    if ($chk->fetch()) {
        json_resp(['success' => false, 'message' => 'อีเมลนี้มีอยู่ในระบบแล้ว'], 409);
    }

    $id = 'u-' . substr(gen_uuid(), 0, 8);
    $ins = $pdo->prepare("INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $ins->execute([$id, $name, $email, $role, $dept, $pos, $avatar, $pin]);

    json_resp(['success' => true, 'message' => 'เพิ่มผู้ใช้งานสำเร็จ']);
}

// 18. PUT /api/admin/users/:id
if ($method === 'PUT' && preg_match('#^/admin/users/([^/]+)$#', $path, $matches)) {
    $uId = $matches[1];
    $b = get_json_body();
    $stmt = $pdo->prepare("
        UPDATE users 
        SET name = ?, email = ?, role = ?, department = ?, position_title = ?, pin_code = ? 
        WHERE id = ?
    ");
    $stmt->execute([
        trim($b['name'] ?? ''),
        strtolower(trim($b['email'] ?? '')),
        $b['role'] ?? 'teacher',
        $b['department'] ?? 'กลุ่มสาระการเรียนรู้ทั่วไป',
        $b['position_title'] ?? 'ครูผู้สอน',
        $b['pin_code'] ?? '1234',
        $uId
    ]);
    json_resp(['success' => true, 'message' => 'อัปเดตข้อมูลผู้ใช้งานสำเร็จ']);
}

// 19. DELETE /api/admin/users/:id
if ($method === 'DELETE' && preg_match('#^/admin/users/([^/]+)$#', $path, $matches)) {
    $stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
    $stmt->execute([$matches[1]]);
    json_resp(['success' => true, 'message' => 'ลบผู้ใช้งานเรียบร้อยแล้ว']);
}

// 19.1 PUT /api/admin/users/:id/reset-pin
if ($method === 'PUT' && preg_match('#^/admin/users/([^/]+)/reset-pin$#', $path, $matches)) {
    $uId = $matches[1];
    $b = get_json_body();
    $pin = trim($b['pin'] ?? '1234');
    if (strlen($pin) !== 4) $pin = '1234';

    $uStmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
    $uStmt->execute([$uId]);
    $user = $uStmt->fetch();
    if (!$user) {
        json_resp(['success' => false, 'message' => 'ไม่พบผู้ใช้งานนี้ในระบบ'], 404);
    }

    $upd = $pdo->prepare("UPDATE users SET pin_code = ? WHERE id = ?");
    $upd->execute([$pin, $uId]);

    if ($user['role'] === 'dept_head' && !empty($user['department'])) {
        $dUpd = $pdo->prepare("UPDATE departments SET head_pin = ? WHERE name = ?");
        $dUpd->execute([$pin, $user['department']]);
    }

    json_resp([
        'success' => true,
        'message' => "รีเซ็ตรหัส PIN ของ {$user['name']} เป็น \"{$pin}\" เรียบร้อยแล้ว",
        'newPin' => $pin
    ]);
}

// 19.2 POST /api/admin/terms
if ($method === 'POST' && $path === '/admin/terms') {
    $b = get_json_body();
    $code = trim($b['code'] ?? '');
    $name = trim($b['name'] ?? '');
    $start = trim($b['start_date'] ?? '');
    $end = trim($b['end_date'] ?? '');
    $isActive = !empty($b['is_active']) ? 1 : 0;

    if (!$code || !$name) {
        json_resp(['success' => false, 'message' => 'กรุณาระบุรหัสภาคเรียนและชื่อภาคเรียน'], 400);
    }

    $id = 'term-' . preg_replace('/[^a-zA-Z0-9]/', '-', $code);
    if ($isActive) {
        $pdo->query("UPDATE academic_terms SET is_active = 0");
    }

    $stmt = $pdo->prepare("
        INSERT INTO academic_terms (id, code, name, is_active, start_date, end_date) 
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active), start_date = VALUES(start_date), end_date = VALUES(end_date)
    ");
    $stmt->execute([$id, $code, $name, $isActive, $start, $end]);

    json_resp(['success' => true, 'message' => 'เพิ่มภาคเรียนสำเร็จ']);
}

// 19.3 PUT /api/admin/terms/:id/toggle
if ($method === 'PUT' && preg_match('#^/admin/terms/([^/]+)/toggle$#', $path, $matches)) {
    $tId = $matches[1];
    $b = get_json_body();
    $tStmt = $pdo->prepare("SELECT * FROM academic_terms WHERE id = ?");
    $tStmt->execute([$tId]);
    $term = $tStmt->fetch();
    if (!$term) json_resp(['success' => false, 'message' => 'ไม่พบข้อมูลภาคเรียน'], 404);

    $newState = isset($b['active']) ? ($b['active'] ? 1 : 0) : ($term['is_active'] ? 0 : 1);
    if ($newState === 1) {
        $pdo->query("UPDATE academic_terms SET is_active = 0");
        $uStmt = $pdo->prepare("UPDATE academic_terms SET is_active = 1 WHERE id = ?");
        $uStmt->execute([$tId]);
        json_resp(['success' => true, 'message' => "เปิดรับแผนการสอนสำหรับ \"{$term['name']}\" เรียบร้อยแล้ว", 'is_active' => 1]);
    } else {
        $uStmt = $pdo->prepare("UPDATE academic_terms SET is_active = 0 WHERE id = ?");
        $uStmt->execute([$tId]);
        json_resp(['success' => true, 'message' => "ปิดรับแผนการสอนสำหรับ \"{$term['name']}\" เรียบร้อยแล้ว", 'is_active' => 0]);
    }
}

// 19.4 PUT /api/admin/terms/:id
if ($method === 'PUT' && preg_match('#^/admin/terms/([^/]+)$#', $path, $matches)) {
    $tId = $matches[1];
    $b = get_json_body();
    $stmt = $pdo->prepare("UPDATE academic_terms SET code = ?, name = ?, start_date = ?, end_date = ? WHERE id = ?");
    $stmt->execute([
        trim($b['code'] ?? ''),
        trim($b['name'] ?? ''),
        $b['start_date'] ?? '',
        $b['end_date'] ?? '',
        $tId
    ]);
    json_resp(['success' => true, 'message' => 'อัปเดตข้อมูลภาคเรียนสำเร็จ']);
}

// 19.5 DELETE /api/admin/terms/:id
if ($method === 'DELETE' && preg_match('#^/admin/terms/([^/]+)$#', $path, $matches)) {
    $tId = $matches[1];
    $stmt = $pdo->prepare("DELETE FROM academic_terms WHERE id = ?");
    $stmt->execute([$tId]);
    json_resp(['success' => true, 'message' => 'ลบข้อมูลภาคเรียนเรียบร้อยแล้ว']);
}

// 19.6 POST /api/admin/system/verify-timelines
if ($method === 'POST' && $path === '/admin/system/verify-timelines') {
    $plans = $pdo->query("SELECT id, submission_status, teacher_name, current_stage FROM lesson_plans")->fetchAll();
    $repairedCount = 0;
    foreach ($plans as $p) {
        $chk = $pdo->prepare("SELECT COUNT(*) FROM approval_timeline WHERE lesson_plan_id = ?");
        $chk->execute([$p['id']]);
        if ($chk->fetchColumn() == 0) {
            init_approval_timeline($pdo, $p['id'], $p['teacher_name'] ?? 'ครูผู้สอน', $p['current_stage'] ?? 'dept_head', $p['submission_status'] ?? 'submitted', 1);
            $repairedCount++;
        }
    }
    json_resp([
        'success' => true,
        'message' => "ตรวจสอบระบบเสร็จสิ้น ตรวจพบแผนการสอนทั้งหมด " . count($plans) . " แผน และซ่อมแซมไทม์ไลน์ที่ขาดหายไป {$repairedCount} แผน",
        'totalPlans' => count($plans),
        'repairedCount' => $repairedCount
    ]);
}

// 20. GET /api/admin/stats
if ($method === 'GET' && $path === '/admin/stats') {
    $totalPlans = $pdo->query("SELECT COUNT(*) FROM lesson_plans")->fetchColumn();
    $approvedPlans = $pdo->query("SELECT COUNT(*) FROM lesson_plans WHERE submission_status = 'approved'")->fetchColumn();
    $pendingPlans = $pdo->query("SELECT COUNT(*) FROM lesson_plans WHERE submission_status IN ('submitted', 'under_review')")->fetchColumn();
    $revisionPlans = $pdo->query("SELECT COUNT(*) FROM lesson_plans WHERE submission_status = 'revision_needed'")->fetchColumn();
    $totalTeachers = $pdo->query("SELECT COUNT(*) FROM users WHERE role = 'teacher'")->fetchColumn();

    $deptStats = $pdo->query("
        SELECT d.name as department, 
               COUNT(lp.id) as count,
               SUM(CASE WHEN lp.submission_status = 'approved' THEN 1 ELSE 0 END) as approved,
               SUM(CASE WHEN lp.submission_status IN ('submitted', 'under_review') THEN 1 ELSE 0 END) as pending
        FROM departments d
        LEFT JOIN lesson_plans lp ON lp.teacher_department = d.name
        GROUP BY d.name
        ORDER BY d.name ASC
    ")->fetchAll();

    json_resp([
        'success' => true,
        'data' => [
            'totalPlans' => intval($totalPlans),
            'approvedPlans' => intval($approvedPlans),
            'pendingPlans' => intval($pendingPlans),
            'revisionPlans' => intval($revisionPlans),
            'totalTeachers' => intval($totalTeachers),
            'deptStats' => $deptStats
        ]
    ]);
}

// -------------------------------------------------------------
// Google Drive Helper Functions
// -------------------------------------------------------------
function getGoogleCredentials() {
    $candidates = [
        __DIR__ . '/../../credentials/service-account.json',
        __DIR__ . '/../credentials/service-account.json',
        dirname(__DIR__, 2) . '/credentials/service-account.json',
        __DIR__ . '/credentials/service-account.json'
    ];
    foreach ($candidates as $p) {
        if (file_exists($p)) {
            $json = json_decode(file_get_contents($p), true);
            if ($json && !empty($json['client_email']) && !empty($json['private_key'])) {
                return $json;
            }
        }
    }
    return null;
}

function getGoogleAccessToken() {
    static $cachedToken = null;
    static $tokenExpiry = 0;
    if ($cachedToken && time() < $tokenExpiry - 60) {
        return $cachedToken;
    }

    $cred = getGoogleCredentials();
    if (!$cred) return null;

    $now = time();
    $header = ['alg' => 'RS256', 'typ' => 'JWT'];
    $claim = [
        'iss' => $cred['client_email'],
        'scope' => 'https://www.googleapis.com/auth/drive',
        'aud' => 'https://oauth2.googleapis.com/token',
        'exp' => $now + 3600,
        'iat' => $now
    ];

    $b64Url = function($data) {
        return str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(is_string($data) ? $data : json_encode($data)));
    };

    $sigPayload = $b64Url($header) . '.' . $b64Url($claim);
    $signature = '';
    if (!openssl_sign($sigPayload, $signature, $cred['private_key'], OPENSSL_ALGO_SHA256)) {
        return null;
    }

    $jwt = $sigPayload . '.' . $b64Url($signature);

    $ch = curl_init('https://oauth2.googleapis.com/token');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $jwt
        ]),
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true
    ]);
    $res = curl_exec($ch);
    curl_close($ch);

    if (!$res) return null;
    $resData = json_decode($res, true);
    if (!empty($resData['access_token'])) {
        $cachedToken = $resData['access_token'];
        $tokenExpiry = $now + ($resData['expires_in'] ?? 3600);
        return $cachedToken;
    }
    return null;
}

function getOrCreateGoogleDriveFolder($token, $folderName, $parentId = null) {
    if (!$token) return null;
    $cleanName = trim($folderName);
    
    // 1. Search for existing folder
    $query = "mimeType = 'application/vnd.google-apps.folder' and name = '" . addslashes($cleanName) . "' and trashed = false";
    if ($parentId) {
        $query .= " and '{$parentId}' in parents";
    }

    $url = 'https://www.googleapis.com/drive/v3/files?' . http_build_query([
        'q' => $query,
        'fields' => 'files(id, name, webViewLink)',
        'spaces' => 'drive',
        'supportsAllDrives' => 'true',
        'includeItemsFromAllDrives' => 'true',
        'corpora' => 'allDrives',
        'pageSize' => 1
    ]);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"],
        CURLOPT_TIMEOUT => 8,
        CURLOPT_SSL_VERIFYPEER => true
    ]);
    $res = curl_exec($ch);
    curl_close($ch);

    if ($res) {
        $data = json_decode($res, true);
        if (!empty($data['files'][0]['id'])) {
            return [
                'id' => $data['files'][0]['id'],
                'link' => $data['files'][0]['webViewLink'] ?? ("https://drive.google.com/drive/folders/" . $data['files'][0]['id'])
            ];
        }
    }

    // 2. Create if not found
    $body = [
        'name' => $cleanName,
        'mimeType' => 'application/vnd.google-apps.folder'
    ];
    if ($parentId) {
        $body['parents'] = [$parentId];
    }

    $ch = curl_init('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer {$token}",
            "Content-Type: application/json"
        ],
        CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_TIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true
    ]);
    $res = curl_exec($ch);
    curl_close($ch);

    if ($res) {
        $data = json_decode($res, true);
        if (!empty($data['id'])) {
            return [
                'id' => $data['id'],
                'link' => $data['webViewLink'] ?? ("https://drive.google.com/drive/folders/" . $data['id'])
            ];
        }
    }

    return null;
}

function deleteGoogleDriveFile($fileId) {
    if (!$fileId || strpos($fileId, 'mock_') === 0 || strpos($fileId, 'gdrive_') === 0) return false;
    
    // 1. Try Google Drive API directly if Service Account token available
    try {
        $token = getGoogleAccessToken();
        if ($token) {
            $ch = curl_init("https://www.googleapis.com/drive/v3/files/{$fileId}?supportsAllDrives=true");
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_CUSTOMREQUEST => 'DELETE',
                CURLOPT_HTTPHEADER => ["Authorization: Bearer {$token}"],
                CURLOPT_TIMEOUT => 15,
                CURLOPT_SSL_VERIFYPEER => true
            ]);
            curl_exec($ch);
            $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            if ($http === 200 || $http === 204) return true;
        }
    } catch (Exception $e) {}

    // 2. Also notify Google Apps Script Web App to trash/delete
    try {
        $envPath = __DIR__ . '/../../.env';
        $webAppUrl = 'https://script.google.com/macros/s/AKfycbwj0MbEaIonkYhTbiI0HbVV1SgzDU4GqtrVwyBI0Eld5MgcoORD1040myQX13djqwLH/exec';
        if (file_exists($envPath)) {
            $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                if (strpos(trim($line), 'GOOGLE_SCRIPT_WEBAPP_URL=') === 0) {
                    $webAppUrl = trim(substr($line, strlen('GOOGLE_SCRIPT_WEBAPP_URL=')));
                }
            }
        }
        if ($webAppUrl) {
            $ch = curl_init($webAppUrl);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_POST => true,
                CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
                CURLOPT_POSTFIELDS => json_encode(['action' => 'delete', 'fileId' => $fileId]),
                CURLOPT_TIMEOUT => 15,
                CURLOPT_SSL_VERIFYPEER => true
            ]);
            curl_exec($ch);
            curl_close($ch);
        }
    } catch (Exception $e) {}

    return true;
}

function uploadViaGoogleScript($filePath, $fileName, $department, $teacherName, $deleteFileId = null) {
    $envPath = __DIR__ . '/../../.env';
    $webAppUrl = 'https://script.google.com/macros/s/AKfycbwj0MbEaIonkYhTbiI0HbVV1SgzDU4GqtrVwyBI0Eld5MgcoORD1040myQX13djqwLH/exec';

    if (file_exists($envPath)) {
        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (strpos(trim($line), 'GOOGLE_SCRIPT_WEBAPP_URL=') === 0) {
                $webAppUrl = trim(substr($line, strlen('GOOGLE_SCRIPT_WEBAPP_URL=')));
            }
        }
    }

    if (!$webAppUrl || !file_exists($filePath)) return null;

    $fileData = file_get_contents($filePath);
    $postData = [
        'fileName' => $fileName,
        'fileBase64' => base64_encode($fileData),
        'department' => $department ?: 'กลุ่มสาระทั่วไป',
        'teacherName' => $teacherName ?: 'ครูผู้สอน'
    ];
    if ($deleteFileId) {
        $postData['deleteFileId'] = $deleteFileId;
    }

    $ch = curl_init($webAppUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode($postData),
        CURLOPT_TIMEOUT => 90,
        CURLOPT_SSL_VERIFYPEER => true
    ]);
    $res = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($res && $httpCode >= 200 && $httpCode < 400) {
        $data = json_decode($res, true);
        if (!empty($data['success'])) {
            return [
                'fileId' => $data['fileId'] ?? ('gdrive_' . time()),
                'webViewLink' => $data['webViewLink'] ?? "https://drive.google.com/file/d/{$data['fileId']}/view",
                'downloadLink' => $data['downloadLink'] ?? null
            ];
        }
    }
    return null;
}

function uploadFileToGoogleDrive($token, $filePath, $fileName, $targetFolderId = null, $department = '', $teacherName = '') {
    // Direct Resumable Upload via Google Drive API (Service Account Fallback)
    if (!$token || !file_exists($filePath)) return null;

    $fileSize = filesize($filePath);
    $mimeType = 'application/pdf';

    $metadata = [
        'name' => $fileName,
        'mimeType' => $mimeType
    ];
    if ($targetFolderId) {
        $metadata['parents'] = [$targetFolderId];
    }

    // Step 1: Initialize Resumable Upload Session
    $initUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink';
    $ch = curl_init($initUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            "Authorization: Bearer {$token}",
            "Content-Type: application/json; charset=UTF-8",
            "X-Upload-Content-Type: {$mimeType}",
            "X-Upload-Content-Length: {$fileSize}"
        ],
        CURLOPT_POSTFIELDS => json_encode($metadata),
        CURLOPT_TIMEOUT => 30,
        CURLOPT_SSL_VERIFYPEER => true
    ]);
    $initRes = curl_exec($ch);
    $initHttp = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($initHttp !== 200 || !$initRes) {
        @file_put_contents(__DIR__ . '/../../data/gdrive_error.log', date('Y-m-d H:i:s') . " Init HTTP: {$initHttp} Res: {$initRes}\n", FILE_APPEND);
        return null;
    }

    $uploadLocation = null;
    if (preg_match('/^location:\s*(.*?)$/mi', $initRes, $matches)) {
        $uploadLocation = trim($matches[1]);
    }

    if (!$uploadLocation) return null;

    $fileHandle = fopen($filePath, 'rb');
    $ch = curl_init($uploadLocation);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_INFILE => $fileHandle,
        CURLOPT_INFILESIZE => $fileSize,
        CURLOPT_UPLOAD => true,
        CURLOPT_HTTPHEADER => [
            "Content-Length: {$fileSize}",
            "Content-Type: {$mimeType}"
        ],
        CURLOPT_TIMEOUT => 120,
        CURLOPT_SSL_VERIFYPEER => true
    ]);
    $uploadRes = curl_exec($ch);
    $uploadHttp = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if (is_resource($fileHandle)) fclose($fileHandle);

    if ($uploadRes && ($uploadHttp === 200 || $uploadHttp === 201)) {
        $data = json_decode($uploadRes, true);
        if (!empty($data['id'])) {
            return [
                'fileId' => $data['id'],
                'webViewLink' => $data['webViewLink'] ?? "https://drive.google.com/file/d/{$data['id']}/view?usp=sharing",
                'downloadLink' => $data['webContentLink'] ?? null
            ];
        }
    }

    return null;
}


// 21. GET /api/admin/drive/status
if ($method === 'GET' && $path === '/admin/drive/status') {
    $cred = getGoogleCredentials();
    $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
    $isConfigured = !empty($cred);
    $serviceEmail = $cred['client_email'] ?? 'lesson-plan@slp-f-2569.iam.gserviceaccount.com';

    json_resp([
        'success' => true,
        'data' => [
            'isConfigured' => $isConfigured,
            'mode' => $isConfigured ? 'live' : 'simulation',
            'rootFolderId' => $rootFolderId,
            'serviceAccountEmail' => $serviceEmail,
            'webViewLink' => 'https://drive.google.com/drive/folders/' . $rootFolderId
        ]
    ]);
}

// 22. POST /api/admin/drive/sync-folders
if ($method === 'POST' && $path === '/admin/drive/sync-folders') {
    @set_time_limit(60);
    // 1. Fetch departments
    $deptStmt = $pdo->query("SELECT id, name FROM departments ORDER BY name ASC");
    $departments = $deptStmt->fetchAll();

    // 2. Fetch teachers & dept heads
    $userStmt = $pdo->query("SELECT id, name, email, department, role FROM users WHERE role IN ('teacher', 'dept_head') ORDER BY name ASC");
    $allTeachers = $userStmt->fetchAll();

    $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
    $token = null;
    try {
        $token = getGoogleAccessToken();
    } catch (Exception $e) {}

    // Group teachers by department
    $deptTeachersMap = [];
    foreach ($allTeachers as $t) {
        $dName = trim($t['department'] ?? 'กลุ่มสาระทั่วไป');
        if (!isset($deptTeachersMap[$dName])) {
            $deptTeachersMap[$dName] = [];
        }
        $deptTeachersMap[$dName][] = $t;
    }

    $tree = [];
    $departmentsCreated = 0;
    $teachersCreated = 0;

    foreach ($departments as $dept) {
        $deptName = trim($dept['name']);
        $departmentsCreated++;

        $deptFolderInfo = null;
        if ($token) {
            try {
                $deptFolderInfo = getOrCreateGoogleDriveFolder($token, $deptName, $rootFolderId);
            } catch (Exception $e) {}
        }

        $deptFolderId = $deptFolderInfo['id'] ?? ('fld_' . substr(md5($deptName), 0, 16));
        $deptLink = $deptFolderInfo['link'] ?? ("https://drive.google.com/drive/folders/" . ($deptFolderInfo['id'] ?? $rootFolderId));

        $teachersInDept = $deptTeachersMap[$deptName] ?? [];
        $tFormatted = [];

        foreach ($teachersInDept as $teacher) {
            $teachersCreated++;
            $tFolderInfo = null;
            if ($token && !empty($deptFolderInfo['id'])) {
                try {
                    $tFolderInfo = getOrCreateGoogleDriveFolder($token, $teacher['name'], $deptFolderInfo['id']);
                } catch (Exception $e) {}
            }

            $tFolderId = $tFolderInfo['id'] ?? ('t_' . substr(md5($teacher['email'] . $deptName), 0, 16));
            $tLink = $tFolderInfo['link'] ?? ("https://drive.google.com/drive/folders/" . ($tFolderInfo['id'] ?? $deptFolderId));

            $tFormatted[] = [
                'name' => $teacher['name'],
                'email' => $teacher['email'],
                'folderId' => $tFolderId,
                'link' => $tLink
            ];
        }

        $tree[] = [
            'department' => $deptName,
            'folderId' => $deptFolderId,
            'link' => $deptLink,
            'teachers' => $tFormatted
        ];
    }

    json_resp([
        'success' => true,
        'message' => "ซิงค์โครงสร้างโฟลเดอร์สำเร็จ: สร้าง/ตรวจพบกลุ่มสาระฯ {$departmentsCreated} หมวด และครู {$teachersCreated} ท่าน",
        'data' => [
            'totalDepartments' => count($departments),
            'totalTeachers' => count($allTeachers),
            'departmentsCreated' => $departmentsCreated,
            'teachersCreated' => $teachersCreated,
            'tree' => $tree
        ]
    ]);
}

// 23. GET /api/files/download/:id
if ($method === 'GET' && preg_match('#^/files/download/([^/]+)$#', $path, $matches)) {
    $planId = $matches[1];
    $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) {
        http_response_code(404);
        die('ไม่พบข้อมูลแผนการสอน');
    }

    $filePath = $plan['stamped_file_path'] ?? $plan['local_file_path'];
    $fullPath = __DIR__ . '/../../' . ltrim($filePath, '/');

    if (!$filePath || !file_exists($fullPath)) {
        if (!empty($plan['google_drive_download_link'])) {
            header('Location: ' . $plan['google_drive_download_link']);
            exit;
        } elseif (!empty($plan['google_drive_view_link'])) {
            header('Location: ' . $plan['google_drive_view_link']);
            exit;
        }
        http_response_code(404);
        die('ไม่พบไฟล์เอกสารบนเซิร์ฟเวอร์');
    }

    $fileName = $plan['file_original_name'] ?: 'lesson_plan.pdf';
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . rawurlencode($fileName) . '"');
    header('Content-Length: ' . filesize($fullPath));
    readfile($fullPath);
    exit;
}

// 24. GET /api/files/view-stamped/:id
if ($method === 'GET' && preg_match('#^/files/view-stamped/([^/]+)$#', $path, $matches)) {
    $planId = $matches[1];
    $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) {
        http_response_code(404);
        die('ไม่พบข้อมูลแผนการสอน');
    }

    $filePath = $plan['stamped_file_path'] ?? $plan['local_file_path'];
    $fullPath = __DIR__ . '/../../' . ltrim($filePath, '/');

    if (!$filePath || !file_exists($fullPath)) {
        if (!empty($plan['google_drive_view_link'])) {
            header('Location: ' . $plan['google_drive_view_link']);
            exit;
        }
        http_response_code(404);
        die('ไม่พบไฟล์เอกสารบนเซิร์ฟเวอร์');
    }

    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . rawurlencode($plan['file_original_name'] ?: 'lesson_plan.pdf') . '"');
    header('Content-Length: ' . filesize($fullPath));
    readfile($fullPath);
    exit;
}

// Fallback: 404 Not Found
json_resp(['success' => false, 'message' => "API endpoint not found: {$method} {$path}"], 404);

