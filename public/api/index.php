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

@error_reporting(0);
@ini_set('display_errors', '0');
@ini_set('memory_limit', '512M');
@set_time_limit(300);
if (ob_get_level() === 0) {
    @ob_start();
}

// Global Exception & Shutdown Handlers (Always return clean JSON)
set_exception_handler(function($e) {
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(500);
    }
    $flags = JSON_UNESCAPED_UNICODE;
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    if (defined('JSON_PARTIAL_OUTPUT_ON_ERROR')) $flags |= JSON_PARTIAL_OUTPUT_ON_ERROR;
    echo json_encode(['success' => false, 'message' => $e->getMessage(), 'error' => $e->getMessage()], $flags);
    exit;
});

register_shutdown_function(function() {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        while (ob_get_level() > 0) {
            @ob_end_clean();
        }
        if (!headers_sent()) {
            header('Content-Type: application/json; charset=utf-8');
            http_response_code(500);
        }
        $msg = $err['message'] . ' in ' . basename($err['file']) . ' line ' . $err['line'];
        $flags = JSON_UNESCAPED_UNICODE;
        if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
        if (defined('JSON_PARTIAL_OUTPUT_ON_ERROR')) $flags |= JSON_PARTIAL_OUTPUT_ON_ERROR;
        echo json_encode(['success' => false, 'message' => $msg, 'error' => $msg], $flags);
    }
});

// -------------------------------------------------------------
// Database Connection
// -------------------------------------------------------------
function getDatabase() {
    static $pdo = null;
    if ($pdo !== null) return $pdo;

    // Load .env if available (safe against open_basedir)
    $envCandidates = [__DIR__ . '/../.env', __DIR__ . '/../../.env'];
    $dbHost = 'localhost';
    $dbPort = '3306';
    $dbUser = 'saluangac_plan';
    $dbPass = 'wun426655';
    $dbName = 'saluangac_plan';

    foreach ($envCandidates as $envPath) {
        if (@file_exists($envPath)) {
            $lines = @file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (is_array($lines)) {
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
            break;
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
    while (ob_get_level() > 0) {
        @ob_end_clean();
    }
    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code($status);
    }
    $flags = JSON_UNESCAPED_UNICODE;
    if (defined('JSON_INVALID_UTF8_SUBSTITUTE')) $flags |= JSON_INVALID_UTF8_SUBSTITUTE;
    if (defined('JSON_PARTIAL_OUTPUT_ON_ERROR')) $flags |= JSON_PARTIAL_OUTPUT_ON_ERROR;
    $out = json_encode($data, $flags);
    if ($out === false) {
        $out = json_encode(['success' => false, 'message' => 'JSON encode error: ' . json_last_error_msg()], JSON_UNESCAPED_UNICODE);
    }
    echo $out;
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
    if (!@file_exists($path)) {
        @mkdir($path, 0755, true);
    }
}

/**
 * Returns a guaranteed writable upload directory that respects shared hosting open_basedir
 */
function get_upload_dir() {
    $candidates = [
        __DIR__ . '/../data/uploads',
        __DIR__ . '/../../data/uploads',
        __DIR__ . '/uploads',
        sys_get_temp_dir() . '/lesson_plan_uploads'
    ];
    foreach ($candidates as $dir) {
        if (@is_dir($dir) && @is_writable($dir)) {
            return $dir;
        }
        if (@mkdir($dir, 0755, true) && @is_dir($dir) && @is_writable($dir)) {
            return $dir;
        }
    }
    return __DIR__ . '/../data/uploads';
}

/**
 * Moves or copies uploaded PDF to writable storage; falls back to tmp_name if needed
 */
function save_uploaded_pdf_file($tmpFilePath, $uniqueFileName) {
    $uploadDir = get_upload_dir();
    $destPath = $uploadDir . '/' . $uniqueFileName;
    $moved = @move_uploaded_file($tmpFilePath, $destPath);
    if (!$moved || !@file_exists($destPath)) {
        @copy($tmpFilePath, $destPath);
    }
    if (@file_exists($destPath) && @filesize($destPath) > 0) {
        return $destPath;
    }
    return $tmpFilePath;
}

/**
 * Searches all candidate upload directories for a relative path or filename
 */
function find_existing_local_pdf($relPath) {
    if (empty($relPath)) return null;
    $clean = ltrim($relPath, '/\\');
    $base = basename($clean);
    $candidates = [
        __DIR__ . '/../' . $clean,
        __DIR__ . '/../data/uploads/' . $base,
        __DIR__ . '/../../' . $clean,
        __DIR__ . '/../../data/uploads/' . $base,
        __DIR__ . '/uploads/' . $base,
        sys_get_temp_dir() . '/lesson_plan_uploads/' . $base
    ];
    foreach ($candidates as $c) {
        if (@file_exists($c) && @is_file($c) && @filesize($c) > 0) {
            return $c;
        }
    }
    return null;
}

function delete_local_pdf_if_exists($relPath) {
    if (empty($relPath)) return;
    $clean = ltrim($relPath, '/\\');
    $base = basename($clean);
    $candidates = [
        __DIR__ . '/../' . $clean,
        __DIR__ . '/../data/uploads/' . $base,
        __DIR__ . '/../../' . $clean,
        __DIR__ . '/../../data/uploads/' . $base,
        __DIR__ . '/uploads/' . $base
    ];
    foreach ($candidates as $c) {
        if (@file_exists($c) && @is_file($c)) {
            @unlink($c);
        }
    }
}

/**
 * Resolves a lesson plan's PDF file on disk, or automatically fetches & caches it from Google Drive
 */
function resolve_plan_pdf_path($plan) {
    if (!$plan) return null;

    $pathsToTry = array_filter([
        !empty($plan['stamped_file_path']) ? $plan['stamped_file_path'] : null,
        !empty($plan['local_file_path']) ? $plan['local_file_path'] : null
    ]);
    foreach ($pathsToTry as $rel) {
        $found = find_existing_local_pdf($rel);
        if ($found) return $found;
    }

    // Fallback: Download from Google Drive if file ID or link is available
    $driveFileId = $plan['google_drive_file_id'] ?? '';
    if (empty($driveFileId) && !empty($plan['google_drive_view_link'])) {
        if (preg_match('#/d/([a-zA-Z0-9_-]+)#', $plan['google_drive_view_link'], $m)) {
            $driveFileId = $m[1];
        } elseif (preg_match('#[?&]id=([a-zA-Z0-9_-]+)#', $plan['google_drive_view_link'], $m)) {
            $driveFileId = $m[1];
        }
    }
    if (!empty($driveFileId) && strpos($driveFileId, 'mock_') !== 0 && strpos($driveFileId, 'gdrive_') !== 0) {
        $dlUrl = "https://drive.google.com/uc?export=download&id=" . rawurlencode($driveFileId);
        $ch = curl_init($dlUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HEADER, true);
        curl_setopt($ch, CURLOPT_HTTPGET, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 20);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LessonPlanSystem/1.0');

        $raw = curl_exec($ch);
        $code = intval(curl_getinfo($ch, CURLINFO_HTTP_CODE));
        $hSize = intval(curl_getinfo($ch, CURLINFO_HEADER_SIZE));
        $rUrl = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
        curl_close($ch);

        $headers = $raw !== false ? substr($raw, 0, $hSize) : '';
        $body = $raw !== false ? substr($raw, $hSize) : '';

        $hops = 0;
        while (in_array($code, [301, 302, 303, 307, 308]) && $hops < 5) {
            $hops++;
            if (empty($rUrl) && preg_match('/^Location:\s*(.+)$/mi', $headers, $m)) {
                $rUrl = trim($m[1]);
            }
            if (empty($rUrl)) break;
            $ch2 = curl_init($rUrl);
            curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch2, CURLOPT_HEADER, true);
            curl_setopt($ch2, CURLOPT_HTTPGET, true);
            curl_setopt($ch2, CURLOPT_TIMEOUT, 60);
            curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 20);
            curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch2, CURLOPT_SSL_VERIFYHOST, 0);
            curl_setopt($ch2, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LessonPlanSystem/1.0');
            $raw2 = curl_exec($ch2);
            $code = intval(curl_getinfo($ch2, CURLINFO_HTTP_CODE));
            $hSize2 = intval(curl_getinfo($ch2, CURLINFO_HEADER_SIZE));
            $rUrl = curl_getinfo($ch2, CURLINFO_REDIRECT_URL);
            curl_close($ch2);
            if ($raw2 === false) break;
            $headers = substr($raw2, 0, $hSize2);
            $body = substr($raw2, $hSize2);
        }

        if ($code === 200 && strlen($body) > 100 && strpos($body, '%PDF-') === 0) {
            $cacheDir = get_upload_dir();
            $cacheName = !empty($pathsToTry) ? basename(reset($pathsToTry)) : ('plan_drive_' . $plan['id'] . '.pdf');
            $cachePath = $cacheDir . '/' . $cacheName;
            if (@file_put_contents($cachePath, $body) && @file_exists($cachePath)) {
                return $cachePath;
            }
            $tmpCache = sys_get_temp_dir() . '/' . $cacheName;
            if (@file_put_contents($tmpCache, $body) && @file_exists($tmpCache)) {
                return $tmpCache;
            }
        }
    }

    return null;
}

// -------------------------------------------------------------
// Gmail & Telegram Revision Notification Helpers
// -------------------------------------------------------------
function get_notification_settings() {
    $defaults = [
        'admin_email' => '',
        'smtp_user' => '',
        'smtp_pass' => '',
        'telegram_bot_token' => '',
        'telegram_chat_id' => ''
    ];

    // Check environment / .env values
    $envCandidates = [__DIR__ . '/../.env', __DIR__ . '/../../.env'];
    foreach ($envCandidates as $envPath) {
        if (@file_exists($envPath)) {
            $lines = @file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (is_array($lines)) {
                foreach ($lines as $line) {
                    if (strpos(trim($line), '#') === 0 || strpos($line, '=') === false) continue;
                    list($k, $v) = explode('=', $line, 2);
                    $k = trim($k);
                    $v = trim($v, " \t\n\r\0\x0B\"'");
                    if ($k === 'ADMIN_NOTIFY_EMAIL' && $v !== '') $defaults['admin_email'] = $v;
                    if ($k === 'SMTP_USER' && $v !== '') $defaults['smtp_user'] = $v;
                    if ($k === 'SMTP_PASS' && $v !== '') $defaults['smtp_pass'] = $v;
                    if ($k === 'TELEGRAM_BOT_TOKEN' && $v !== '') $defaults['telegram_bot_token'] = $v;
                    if ($k === 'TELEGRAM_CHAT_ID' && $v !== '') $defaults['telegram_chat_id'] = $v;
                }
            }
            break;
        }
    }

    // Override with persisted admin settings file
    $cfgFile = get_upload_dir() . '/notification_settings.json';
    if (@file_exists($cfgFile)) {
        $raw = @file_get_contents($cfgFile);
        $decoded = $raw ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            foreach ($defaults as $k => $v) {
                if (array_key_exists($k, $decoded) && is_string($decoded[$k])) {
                    $defaults[$k] = trim($decoded[$k]);
                }
            }
        }
    }

    return $defaults;
}

function save_notification_settings($settings) {
    $cfgFile = get_upload_dir() . '/notification_settings.json';
    $clean = [
        'admin_email' => trim((string)($settings['admin_email'] ?? '')),
        'smtp_user' => trim((string)($settings['smtp_user'] ?? '')),
        'smtp_pass' => trim((string)($settings['smtp_pass'] ?? '')),
        'telegram_bot_token' => trim((string)($settings['telegram_bot_token'] ?? '')),
        'telegram_chat_id' => trim((string)($settings['telegram_chat_id'] ?? ''))
    ];
    return @file_put_contents($cfgFile, json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) !== false;
}

function send_smtp_gmail($smtpUser, $smtpPass, $toEmails, $subject, $htmlBody) {
    $smtpUser = trim(str_replace(["\r", "\n"], '', (string)$smtpUser));
    $smtpPass = str_replace([' ', "\r", "\n"], '', (string)$smtpPass);
    if (empty($smtpUser) || empty($smtpPass) || empty($toEmails)) {
        return ['success' => false, 'error' => 'Missing SMTP credentials or recipients'];
    }

    $ctx = stream_context_create([
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true,
            'peer_name' => 'smtp.gmail.com'
        ]
    ]);

    // Resolve IPv4 to bypass potential broken IPv6 routes (fixes Network is unreachable 101 on Linux/VPS)
    $ipv4Addresses = @gethostbynamel('smtp.gmail.com');
    if (!is_array($ipv4Addresses)) {
        $singleIp = @gethostbyname('smtp.gmail.com');
        $ipv4Addresses = ($singleIp && $singleIp !== 'smtp.gmail.com') ? [$singleIp] : [];
    }

    // Build candidates: Try SSL (465) and STARTTLS (587) with hostname and IPv4
    $candidates = [
        ['uri' => 'ssl://smtp.gmail.com:465', 'type' => 'ssl'],
        ['uri' => 'tcp://smtp.gmail.com:587', 'type' => 'tls']
    ];
    foreach ($ipv4Addresses as $ip) {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $candidates[] = ['uri' => "ssl://{$ip}:465", 'type' => 'ssl'];
            $candidates[] = ['uri' => "tcp://{$ip}:587", 'type' => 'tls'];
        }
    }

    $fp = false;
    $connectedType = 'ssl';
    $errors = [];

    foreach ($candidates as $cand) {
        $errno = 0;
        $errstr = '';
        $conn = @stream_socket_client($cand['uri'], $errno, $errstr, 5, STREAM_CLIENT_CONNECT, $ctx);
        if ($conn) {
            $fp = $conn;
            $connectedType = $cand['type'];
            break;
        } else {
            $errors[] = "{$cand['uri']} ({$errstr} {$errno})";
        }
    }

    if (!$fp) {
        $detail = implode(', ', array_slice($errors, 0, 2));
        return [
            'success' => false,
            'error' => "SMTP connect failed: {$detail} (เซิร์ฟเวอร์/โฮสติ้งอาจบล็อกพอร์ตอีเมล 465/587 หรือมีไฟร์วอลล์กั้น แนะนำให้ใช้ Telegram Bot แทนซึ่งไม่ติดบล็อกพอร์ตครับ)"
        ];
    }
    stream_set_timeout($fp, 10);

    $readResp = function() use ($fp) {
        $resp = '';
        while (!feof($fp)) {
            $line = @fgets($fp, 515);
            if ($line === false) break;
            $resp .= $line;
            if (preg_match('/^\d{3} /', $line)) break;
        }
        return $resp;
    };

    $sendCmd = function($cmd, $expectCode) use ($fp, $readResp) {
        @fwrite($fp, $cmd . "\r\n");
        $r = $readResp();
        $code = intval(substr($r, 0, 3));
        return [$code === $expectCode || (is_array($expectCode) && in_array($code, $expectCode)), $r];
    };

    $greet = $readResp();
    if (intval(substr($greet, 0, 3)) !== 220) {
        @fclose($fp);
        return ['success' => false, 'error' => "SMTP greeting failed: {$greet}"];
    }

    list($ok, $r) = $sendCmd('EHLO localhost', 250);
    if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "EHLO failed: {$r}"]; }

    // If connected via port 587 (TLS), upgrade connection using STARTTLS
    if ($connectedType === 'tls') {
        list($ok, $r) = $sendCmd('STARTTLS', 220);
        if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "STARTTLS failed: {$r}"]; }

        $cryptoOk = false;
        if (defined('STREAM_CRYPTO_METHOD_TLS_CLIENT')) {
            $cryptoOk = @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        } else {
            $cryptoOk = @stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_SSLv23_CLIENT);
        }

        if (!$cryptoOk) {
            @fclose($fp);
            return ['success' => false, 'error' => 'TLS crypto handshake failed'];
        }

        list($ok, $r) = $sendCmd('EHLO localhost', 250);
        if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "EHLO after STARTTLS failed: {$r}"]; }
    }

    list($ok, $r) = $sendCmd('AUTH LOGIN', 334);
    if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "AUTH LOGIN failed: {$r}"]; }

    list($ok, $r) = $sendCmd(base64_encode($smtpUser), 334);
    if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "SMTP user rejected: {$r}"]; }

    list($ok, $r) = $sendCmd(base64_encode($smtpPass), 235);
    if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "SMTP auth failed (check Gmail App Password): {$r}"]; }

    list($ok, $r) = $sendCmd("MAIL FROM:<{$smtpUser}>", 250);
    if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "MAIL FROM failed: {$r}"]; }

    $validTos = [];
    foreach ((array)$toEmails as $rcpt) {
        $rcpt = trim(str_replace(["\r", "\n"], '', (string)$rcpt));
        if (!filter_var($rcpt, FILTER_VALIDATE_EMAIL)) continue;
        list($rOk, $rMsg) = $sendCmd("RCPT TO:<{$rcpt}>", [250, 251]);
        if ($rOk) $validTos[] = $rcpt;
    }

    if (empty($validTos)) {
        @fclose($fp);
        return ['success' => false, 'error' => 'No valid recipient accepted'];
    }

    list($ok, $r) = $sendCmd('DATA', 354);
    if (!$ok) { @fclose($fp); return ['success' => false, 'error' => "DATA failed: {$r}"]; }

    $cleanSubject = str_replace(["\r", "\n"], '', $subject);
    $encodedFromName = '=?UTF-8?B?' . base64_encode('ระบบส่งแผนการสอน โรงเรียนสระหลวงพิทยาคม') . '?=';
    $encodedSubject = '=?UTF-8?B?' . base64_encode($cleanSubject) . '?=';

    $headers = [
        "From: {$encodedFromName} <{$smtpUser}>",
        "To: " . implode(', ', $validTos),
        "Subject: {$encodedSubject}",
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: base64",
        "Date: " . date('r')
    ];

    $payload = implode("\r\n", $headers) . "\r\n\r\n" . chunk_split(base64_encode($htmlBody)) . "\r\n.";
    list($ok, $r) = $sendCmd($payload, 250);

    @fwrite($fp, "QUIT\r\n");
    @fclose($fp);

    return $ok
        ? ['success' => true, 'error' => null]
        : ['success' => false, 'error' => "SMTP DATA rejected: {$r}"];
}

function send_telegram_alert($botToken, $chatId, $messageText) {
    $botToken = trim((string)$botToken);
    $chatId = trim((string)$chatId);
    if (empty($botToken) || empty($chatId)) {
        return ['success' => false, 'error' => 'Missing Telegram Bot Token or Chat ID'];
    }

    $url = "https://api.telegram.org/bot{$botToken}/sendMessage";
    $postFields = json_encode([
        'chat_id' => $chatId,
        'text' => $messageText,
        'parse_mode' => 'HTML',
        'disable_web_page_preview' => true
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json; charset=utf-8']);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $postFields);
    curl_setopt($ch, CURLOPT_TIMEOUT, 8);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

    $res = curl_exec($ch);
    $http = intval(curl_getinfo($ch, CURLINFO_HTTP_CODE));
    $err = curl_error($ch);
    curl_close($ch);

    if ($res === false) {
        return ['success' => false, 'error' => $err ?: 'Curl error'];
    }
    $decoded = json_decode($res, true);
    if ($http === 200 && !empty($decoded['ok'])) {
        return ['success' => true, 'error' => null];
    }
    return ['success' => false, 'error' => $decoded['description'] ?? "HTTP {$http}"];
}

function send_revision_notifications($pdo, $planId, $feedback, $reviewerName, $reviewerRole, $roundNumber) {
    $result = [
        'emails_targeted' => [],
        'email_sent' => false,
        'email_method' => 'none',
        'email_error' => null,
        'telegram_sent' => false,
        'telegram_error' => null
    ];

    try {
        $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
        $stmt->execute([$planId]);
        $plan = $stmt->fetch();
        if (!$plan) return $result;

        $settings = get_notification_settings();

        // Collect recipients: Teacher + All DB Admins + Extra Configured Admin Email(s)
        $rawEmails = [];
        if (!empty($plan['teacher_email'])) {
            $rawEmails[] = $plan['teacher_email'];
        }
        $adminStmt = $pdo->query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != ''");
        if ($adminStmt) {
            foreach ($adminStmt->fetchAll() as $adm) {
                if (!empty($adm['email'])) $rawEmails[] = $adm['email'];
            }
        }
        if (!empty($settings['admin_email'])) {
            foreach (preg_split('/[,;\s]+/', $settings['admin_email']) as $extra) {
                if (!empty($extra)) $rawEmails[] = $extra;
            }
        }

        $recipientsMap = [];
        foreach ($rawEmails as $em) {
            $emClean = strtolower(trim((string)$em));
            if (filter_var($emClean, FILTER_VALIDATE_EMAIL)) {
                $recipientsMap[$emClean] = $emClean;
            }
        }
        $recipients = array_values($recipientsMap);
        $result['emails_targeted'] = $recipients;

        $teacherName = $plan['teacher_name'] ?? 'ครูผู้สอน';
        $teacherDept = $plan['teacher_department'] ?? '-';
        $subjectCode = $plan['subject_code'] ?? '-';
        $subjectName = $plan['subject_name'] ?? '-';
        $gradeLevel = $plan['grade_level'] ?? '-';
        $reasonText = trim((string)$feedback) ?: 'ส่งกลับเพื่อแก้ไขปรับปรุงเพิ่มเติม';
        $revName = trim((string)$reviewerName) ?: 'ผู้ตรวจพิจารณา';
        $revRole = trim((string)$reviewerRole) ?: '';
        $revDisplay = $revRole ? "{$revName} ({$revRole})" : $revName;
        $roundLabel = intval($roundNumber) === 2 ? 'ครั้งที่ 2' : 'ครั้งที่ 1';
        $timeNow = date('d/m/Y H:i') . ' น.';

        // Build Email HTML
        $emailSubject = "[แจ้งเตือนตีกลับแผนการสอน] {$subjectCode} - {$subjectName} ({$teacherName})";
        $h = function($s) { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); };

        $emailHtml = '
<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"></head>
<body style="font-family: \'Prompt\', Tahoma, sans-serif; background:#f8fafc; margin:0; padding:20px; color:#1e293b;">
  <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.05);">
    <div style="background:linear-gradient(135deg,#dc2626,#b91c1c); color:#ffffff; padding:20px 24px;">
      <h2 style="margin:0; font-size:18px;">⚠️ แจ้งเตือนการตีกลับแผนการสอน (' . $h($roundLabel) . ')</h2>
      <div style="font-size:13px; opacity:0.9; margin-top:4px;">ระบบส่งแผนการสอนออนไลน์ • โรงเรียนสระหลวงพิทยาคม</div>
    </div>
    <div style="padding:22px 24px; font-size:14px; line-height:1.6;">
      <p style="margin-top:0;">เรียน <strong>' . $h($teacherName) . '</strong> และ <strong>ผู้ดูแลระบบ (Admin)</strong></p>
      <p>มีรายการแผนการสอนถูก <strong>ตีกลับให้แก้ไขปรับปรุง</strong> โดยมีรายละเอียดดังนี้:</p>
      <table style="width:100%; border-collapse:collapse; margin:12px 0; font-size:13.5px;">
        <tr><td style="padding:6px 0; color:#64748b; width:140px;">รายวิชา:</td><td style="padding:6px 0; font-weight:600;">' . $h($subjectCode) . ' - ' . $h($subjectName) . '</td></tr>
        <tr><td style="padding:6px 0; color:#64748b;">ระดับชั้น:</td><td style="padding:6px 0;">' . $h($gradeLevel) . '</td></tr>
        <tr><td style="padding:6px 0; color:#64748b;">ครูผู้สอน:</td><td style="padding:6px 0;">' . $h($teacherName) . ' (' . $h($teacherDept) . ')</td></tr>
        <tr><td style="padding:6px 0; color:#64748b;">ผู้ตรวจที่ตีกลับ:</td><td style="padding:6px 0;">' . $h($revDisplay) . '</td></tr>
        <tr><td style="padding:6px 0; color:#64748b;">วัน-เวลา:</td><td style="padding:6px 0;">' . $h($timeNow) . '</td></tr>
      </table>
      <div style="background:#fef2f2; border-left:4px solid #dc2626; border-radius:8px; padding:14px 16px; margin:16px 0;">
        <div style="font-weight:700; color:#991b1b; margin-bottom:4px;">📌 สาเหตุที่ตีกลับ / ข้อเสนอแนะให้แก้ไข:</div>
        <div style="color:#7f1d1d;">' . nl2br($h($reasonText)) . '</div>
      </div>
      <p style="font-size:13px; color:#64748b; margin-bottom:0;">
        กรุณาเข้าสู่ระบบส่งแผนการสอน ไปที่เมนู <strong>"สถานะของฉัน"</strong> เพื่อตรวจสอบรายละเอียดและกดปุ่ม <strong>"แก้ไข / ส่งฉบับปรับปรุง"</strong>
      </p>
    </div>
  </div>
</body></html>';

        if (!empty($recipients)) {
            if (!empty($settings['smtp_user']) && !empty($settings['smtp_pass'])) {
                $smtpRes = send_smtp_gmail($settings['smtp_user'], $settings['smtp_pass'], $recipients, $emailSubject, $emailHtml);
                $result['email_method'] = 'gmail_smtp';
                $result['email_sent'] = $smtpRes['success'];
                $result['email_error'] = $smtpRes['error'];
            } else {
                $encodedSub = '=?UTF-8?B?' . base64_encode($emailSubject) . '?=';
                $fromEmail = $settings['smtp_user'] ?: ('noreply@' . ($_SERVER['HTTP_HOST'] ?? 'school.local'));
                $mailHeaders = "MIME-Version: 1.0\r\nContent-type: text/html; charset=UTF-8\r\nFrom: ระบบส่งแผนการสอน <{$fromEmail}>\r\n";
                $anySent = false;
                foreach ($recipients as $rcpt) {
                    if (@mail($rcpt, $encodedSub, $emailHtml, $mailHeaders)) {
                        $anySent = true;
                    }
                }
                $result['email_method'] = 'php_mail';
                $result['email_sent'] = $anySent;
                if (!$anySent) {
                    $result['email_error'] = 'ยังไม่ได้ตั้งค่า Gmail SMTP (หรือโฮสต์ปิด PHP mail())';
                }
            }
        }

        // Send Telegram Bot notification if configured
        if (!empty($settings['telegram_bot_token']) && !empty($settings['telegram_chat_id'])) {
            $tgMsg = "⚠️ <b>แจ้งเตือนตีกลับแผนการสอน ({$h($roundLabel)})</b>\n"
                   . "━━━━━━━━━━━━━━━━\n"
                   . "📘 <b>วิชา:</b> {$h($subjectCode)} - {$h($subjectName)}\n"
                   . "👩‍🏫 <b>ครูผู้สอน:</b> {$h($teacherName)}\n"
                   . "🏫 <b>กลุ่มสาระฯ:</b> {$h($teacherDept)}\n"
                   . "🔍 <b>ผู้ตีกลับ:</b> {$h($revDisplay)}\n"
                   . "📌 <b>สาเหตุที่ตีกลับ:</b>\n<blockquote>{$h($reasonText)}</blockquote>\n"
                   . "🕒 <i>{$h($timeNow)}</i>";
            $tgRes = send_telegram_alert($settings['telegram_bot_token'], $settings['telegram_chat_id'], $tgMsg);
            $result['telegram_sent'] = $tgRes['success'];
            $result['telegram_error'] = $tgRes['error'];
        }
    } catch (Exception $e) {
        $result['email_error'] = $e->getMessage();
    }

    return $result;
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
// Version Snapshot Helpers (Auto-archive version before editing)
// -------------------------------------------------------------
function ensure_plan_versions_table($pdo) {
    static $checked = false;
    if ($checked) return;
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS `lesson_plan_versions` (
            `id` VARCHAR(64) NOT NULL,
            `lesson_plan_id` VARCHAR(64) NOT NULL,
            `version_number` INT NOT NULL DEFAULT 1,
            `teacher_name` VARCHAR(255) DEFAULT NULL,
            `teacher_email` VARCHAR(255) DEFAULT NULL,
            `teacher_department` VARCHAR(255) DEFAULT NULL,
            `academic_term_id` VARCHAR(64) DEFAULT NULL,
            `subject_code` VARCHAR(64) DEFAULT NULL,
            `subject_name` VARCHAR(255) DEFAULT NULL,
            `grade_level` VARCHAR(64) DEFAULT NULL,
            `submission_status` VARCHAR(64) DEFAULT 'submitted',
            `current_stage` VARCHAR(64) DEFAULT 'dept_head',
            `current_reviewer_title` VARCHAR(255) DEFAULT NULL,
            `reviewer_feedback` TEXT NULL,
            `file_original_name` VARCHAR(255) DEFAULT NULL,
            `file_size` BIGINT DEFAULT NULL,
            `local_file_path` TEXT NULL,
            `stamped_file_path` TEXT NULL,
            `google_drive_file_id` VARCHAR(255) DEFAULT NULL,
            `google_drive_view_link` TEXT NULL,
            `google_drive_download_link` TEXT NULL,
            `signature_data` LONGTEXT NULL,
            `submission_round` INT DEFAULT 1,
            `current_round` INT DEFAULT 1,
            `round_2_status` VARCHAR(64) DEFAULT 'not_started',
            `snapshot_reason` VARCHAR(255) DEFAULT 'ก่อนแก้ไขแผนการสอน',
            `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`),
            KEY `idx_plan_version` (`lesson_plan_id`),
            KEY `idx_version_num` (`version_number`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");
    $checked = true;
}

function create_plan_snapshot($pdo, $planId, $reason = 'ก่อนแก้ไขแผนการสอน') {
    ensure_plan_versions_table($pdo);

    $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $stmt->execute([$planId]);
    $p = $stmt->fetch();
    if (!$p) return null;

    // Check next version number
    $vStmt = $pdo->prepare("SELECT COALESCE(MAX(version_number), 0) + 1 FROM lesson_plan_versions WHERE lesson_plan_id = ?");
    $vStmt->execute([$planId]);
    $nextVer = intval($vStmt->fetchColumn() ?: 1);

    // Create a preserved backup copy of local file if exists
    $backupLocalPath = $p['local_file_path'];
    $sourceFile = !empty($p['stamped_file_path']) ? $p['stamped_file_path'] : ($p['local_file_path'] ?? '');
    if (!empty($sourceFile)) {
        $realFile = find_existing_local_pdf($sourceFile);
        if ($realFile) {
            $ext = pathinfo($realFile, PATHINFO_EXTENSION) ?: 'pdf';
            $backupFilename = 'plan_backup_v' . $nextVer . '_' . time() . '_' . substr(gen_uuid(), 0, 6) . '.' . $ext;
            $backupDir = get_upload_dir();
            $backupFullPath = $backupDir . '/' . $backupFilename;
            if (@copy($realFile, $backupFullPath)) {
                $backupLocalPath = 'data/uploads/' . $backupFilename;
            }
        }
    }

    $verId = gen_uuid();
    $ins = $pdo->prepare("
        INSERT INTO lesson_plan_versions (
            id, lesson_plan_id, version_number, teacher_name, teacher_email,
            teacher_department, academic_term_id, subject_code, subject_name,
            grade_level, submission_status, current_stage, current_reviewer_title,
            reviewer_feedback, file_original_name, file_size, local_file_path,
            stamped_file_path, google_drive_file_id, google_drive_view_link,
            google_drive_download_link, signature_data, submission_round,
            current_round, round_2_status, snapshot_reason, created_at
        ) VALUES (
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, NOW()
        )
    ");
    $ins->execute([
        $verId, $p['id'], $nextVer, $p['teacher_name'], $p['teacher_email'],
        $p['teacher_department'], $p['academic_term_id'], $p['subject_code'], $p['subject_name'],
        $p['grade_level'], $p['submission_status'], $p['current_stage'], $p['current_reviewer_title'],
        $p['reviewer_feedback'], $p['file_original_name'], $p['file_size'], $backupLocalPath,
        $p['stamped_file_path'], $p['google_drive_file_id'], $p['google_drive_view_link'],
        $p['google_drive_download_link'], $p['signature_data'], $p['submission_round'] ?? 1,
        $p['current_round'] ?? 1, $p['round_2_status'] ?? 'not_started', $reason
    ]);

    return [
        'versionId' => $verId,
        'versionNumber' => $nextVer,
        'status' => $p['submission_status'],
        'created_at' => date('c')
    ];
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
    if (session_status() === PHP_SESSION_NONE) {
        @session_start();
    }

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

    // Rate Limiting / Brute-force Lockout Protection (Max 5 failed attempts -> Lock 5 minutes)
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'client';
    $targetId = $user['id'];
    $attemptKey = 'login_fails_' . md5($ip . '_' . $targetId);
    $lockKey = 'login_lock_' . md5($ip . '_' . $targetId);

    if (isset($_SESSION[$lockKey]) && time() < $_SESSION[$lockKey]) {
        $remainingSec = $_SESSION[$lockKey] - time();
        $remainingMin = ceil($remainingSec / 60);
        json_resp([
            'success' => false,
            'locked' => true,
            'message' => "บัญชีนี้ถูกระงับการเข้าสู่ระบบชั่วคราวเนื่องจากกรอกรหัส PIN ผิดเกินกำหนด กรุณารออีก {$remainingMin} นาที"
        ], 429);
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
                'message' => 'กรุณากรอกรหัส PIN ประจำตัวเพื่อเข้าสู่ระบบ'
            ], 401);
        }

        if (trim($pin) !== $userPin) {
            $fails = ($_SESSION[$attemptKey] ?? 0) + 1;
            $_SESSION[$attemptKey] = $fails;

            if ($fails >= 5) {
                $_SESSION[$lockKey] = time() + 300; // Lock for 5 minutes
                unset($_SESSION[$attemptKey]);
                json_resp([
                    'success' => false,
                    'locked' => true,
                    'message' => 'คุณกรอกรหัส PIN ผิดเกิน 5 ครั้ง ระบบได้ระงับการเข้าสู่ระบบชั่วคราวเป็นเวลา 5 นาที เพื่อความปลอดภัย'
                ], 429);
            }

            $remainingTries = 5 - $fails;
            json_resp([
                'success' => false,
                'requirePin' => true,
                'message' => "รหัส PIN ไม่ถูกต้อง (เหลือโอกาสลองอีก {$remainingTries} ครั้ง)"
            ], 401);
        }
    }

    // Login successful: Clear failed login tracker
    unset($_SESSION[$attemptKey]);
    unset($_SESSION[$lockKey]);

    json_resp(['success' => true, 'user' => $user]);
}

// 2.1 POST /api/auth/change-pin (Allow users to update their personal PIN)
if ($method === 'POST' && $path === '/auth/change-pin') {
    $body = get_json_body();
    $userId = trim($body['userId'] ?? '');
    $oldPin = trim($body['oldPin'] ?? '');
    $newPin = trim($body['newPin'] ?? '');

    if (!$userId || !$newPin) {
        json_resp(['success' => false, 'message' => 'กรุณากรอกข้อมูลให้ครบถ้วน'], 400);
    }

    if (strlen($newPin) < 4 || strlen($newPin) > 16) {
        json_resp(['success' => false, 'message' => 'รหัส PIN ใหม่ต้องมีความยาวระหว่าง 4 ถึง 16 ตัวอักษร'], 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        json_resp(['success' => false, 'message' => 'ไม่พบบัญชีผู้ใช้งานในระบบ'], 404);
    }

    $currentPin = !empty($user['pin_code']) ? trim($user['pin_code']) : '1234';
    if (!empty($currentPin) && $oldPin !== $currentPin) {
        json_resp(['success' => false, 'message' => 'รหัส PIN ปัจจุบันไม่ถูกต้อง'], 403);
    }

    $upd = $pdo->prepare("UPDATE users SET pin_code = ? WHERE id = ?");
    $upd->execute([$newPin, $userId]);

    // If this user is a department head, sync with department pin
    if ($user['role'] === 'dept_head' && !empty($user['department'])) {
        $updDept = $pdo->prepare("UPDATE departments SET head_pin = ? WHERE name = ?");
        $updDept->execute([$newPin, $user['department']]);
    }

    json_resp([
        'success' => true,
        'message' => 'เปลี่ยนรหัส PIN สำเร็จเรียบร้อยแล้ว กรุณาใช้รหัสใหม่นี้ในการเข้าสู่ระบบครั้งถัดไป'
    ]);
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
        $canEdit = in_array($existing['submission_status'], ['draft', 'revision_needed', 'submitted', 'under_review'])
            || ($existing['round_2_status'] ?? '') === 'revision_needed';
        json_resp([
            'exists' => true,
            'canEdit' => $canEdit,
            'status' => $existing['submission_status'],
            'message' => ($existing['submission_status'] === 'revision_needed' || ($existing['round_2_status'] ?? '') === 'revision_needed')
                ? 'แผนการสอนของคุณถูกตีกลับให้แก้ไข กรุณาแก้ไขหรือแนบไฟล์ใหม่'
                : ($canEdit 
                    ? 'คุณมีแผนการสอนในภาคเรียนนี้แล้ว (สามารถแก้ไขหรือแนบไฟล์ใหม่แทนที่ได้)'
                    : 'คุณได้ส่งแผนการสอนสำหรับภาคเรียนนี้ไปแล้ว'),
            'plan' => [
                'id' => $existing['id'],
                'subject_code' => $existing['subject_code'],
                'subject_name' => $existing['subject_name'],
                'teacher_name' => $existing['teacher_name'],
                'teacher_department' => $existing['teacher_department'],
                'grade_level' => $existing['grade_level'],
                'submission_status' => $existing['submission_status'],
                'current_stage' => $existing['current_stage'],
                'current_reviewer_title' => $existing['current_reviewer_title'] ?? null,
                'round_2_status' => $existing['round_2_status'] ?? 'not_started',
                'round_2_stage' => $existing['round_2_stage'] ?? 'dept_head',
                'file_original_name' => $existing['file_original_name'],
                'created_at' => $existing['created_at'],
                'reviewer_feedback' => $existing['reviewer_feedback'],
                'reviewed_by' => $existing['reviewed_by'] ?? null,
                'reviewed_at' => $existing['reviewed_at'] ?? null,
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
    $subRound = intval($_POST['submission_round'] ?? 1);

    if (!$termId || !$teacherName || !$teacherEmail || !$subjectCode || !$subjectName) {
        json_resp(['success' => false, 'message' => 'กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง'], 400);
    }

    // Check duplicate: 1 teacher can submit 1 plan per academic term
    $chk = $pdo->prepare("SELECT * FROM lesson_plans WHERE LOWER(teacher_email) = ? AND academic_term_id = ?");
    $chk->execute([$teacherEmail, $termId]);
    $existingPlan = $chk->fetch();

    // Special handling if submitting as Round 2
    if ($subRound === 2 && $existingPlan) {
        if ($existingPlan['submission_status'] !== 'approved') {
            json_resp([
                'success' => false,
                'message' => 'ไม่สามารถส่งครั้งที่ 2 ได้ เนื่องจากแผนการสอนครั้งที่ 1 ยังไม่ได้รับการอนุมัติสมบูรณ์'
            ], 400);
        }

        $planId = $existingPlan['id'];
        $sig2 = $signatureData ?: $existingPlan['round_2_signature'];
        $stmt = $pdo->prepare("UPDATE lesson_plans SET round_2_signature = ?, round_2_signed_at = NOW(), round_2_status = 'submitted', round_2_stage = 'dept_head', current_round = 2 WHERE id = ?");
        $stmt->execute([$sig2, $planId]);

        $newDriveLink = $existingPlan['google_drive_view_link'] ?? null;
        if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
            $file = $_FILES['pdf_file'];
            $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
            $destPath = save_uploaded_pdf_file($file['tmp_name'], $uniqueFileName);
            $newLocalPath = 'data/uploads/' . $uniqueFileName;

            $oldDriveIdR2 = $existingPlan['google_drive_file_id'] ?? null;
            try {
                $r2OrigName = $existingPlan['file_original_name'] ?: 'lesson_plan.pdf';
                $r2Dept = $existingPlan['teacher_department'] ?: 'ทั่วไป';
                $r2Teacher = $existingPlan['teacher_name'] ?: 'ครูผู้สอน';
                $driveRes = uploadViaGoogleScript($destPath, $r2OrigName, $r2Dept, $r2Teacher, null);
                if (!$driveRes) {
                    $token = getGoogleAccessToken();
                    if ($token) {
                        $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
                        $driveRes = uploadFileToGoogleDrive($token, $destPath, $r2OrigName, $rootFolderId, $r2Dept, $r2Teacher);
                    }
                }
                if ($driveRes && !empty($driveRes['fileId'])) {
                    $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ?, google_drive_file_id = ?, google_drive_view_link = ?, google_drive_download_link = ? WHERE id = ?");
                    $upd->execute([$newLocalPath, $newLocalPath, $driveRes['fileId'], $driveRes['webViewLink'], $driveRes['downloadLink'], $planId]);
                    $newDriveLink = $driveRes['webViewLink'];
                    if (!empty($oldDriveIdR2) && $oldDriveIdR2 !== $driveRes['fileId']) {
                        deleteGoogleDriveFile($oldDriveIdR2);
                    }
                } else {
                    $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ? WHERE id = ?");
                    $upd->execute([$newLocalPath, $newLocalPath, $planId]);
                }
            } catch (Exception $e) {
                $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ? WHERE id = ?");
                $upd->execute([$newLocalPath, $newLocalPath, $planId]);
            }
        }

        init_approval_timeline($pdo, $planId, $teacherName, 'dept_head', 'submitted', 2);
        json_resp([
            'success' => true,
            'message' => 'บันทึกการส่งและลงนามครั้งที่ 2 สำเร็จ',
            'planId' => $planId,
            'driveViewLink' => $newDriveLink
        ]);
    }

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
                'teacher_name' => $existingPlan['teacher_name'],
                'teacher_department' => $existingPlan['teacher_department'],
                'grade_level' => $existingPlan['grade_level'],
                'submission_status' => $existingPlan['submission_status'],
                'created_at' => $existingPlan['created_at'],
                'reviewer_feedback' => $existingPlan['reviewer_feedback'],
                'google_drive_view_link' => $existingPlan['google_drive_view_link']
            ]
        ], 409);
    }

    // File handling
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
        $destPath = save_uploaded_pdf_file($file['tmp_name'], $uniqueFileName);
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

    $isR2Rev = (($existing['round_2_status'] ?? '') === 'revision_needed');
    if (!in_array($existing['submission_status'], ['submitted', 'under_review', 'revision_needed', 'draft']) && !$isR2Rev) {
        json_resp([
            'success' => false,
            'message' => "ไม่สามารถแก้ไขได้เนื่องจากสถานะปัจจุบันคือ \"{$existing['submission_status']}\""
        ], 403);
    }

    // Step 1: Automatically archive / snapshot current status and file BEFORE modifying
    $snapInfo = create_plan_snapshot($pdo, $planId, 'ก่อนบันทึกการแก้ไข / ลบไฟล์เดิมและบันทึกไฟล์ใหม่');

    $tName = trim($_POST['teacher_name'] ?? $existing['teacher_name']);
    $tDept = trim($_POST['teacher_department'] ?? $existing['teacher_department']);
    $sCode = strtoupper(trim($_POST['subject_code'] ?? $existing['subject_code']));
    $sName = trim($_POST['subject_name'] ?? $existing['subject_name']);
    $gLevel = trim($_POST['grade_level'] ?? $existing['grade_level']);
    $sigData = $_POST['signature_data'] ?? $existing['signature_data'];

    $localFilePath = $existing['local_file_path'];
    $stampedFilePath = $existing['stamped_file_path'] ?? null;
    $originalName = $existing['file_original_name'];
    $fileSize = $existing['file_size'];
    $driveFileId = $existing['google_drive_file_id'];
    $driveViewLink = $existing['google_drive_view_link'];
    $driveDownloadLink = $existing['google_drive_download_link'];
    $fileReplaced = false;

    if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['pdf_file'];
        $originalName = $file['name'];
        $fileSize = $file['size'];
        $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        if ($ext !== 'pdf') {
            json_resp(['success' => false, 'message' => 'รองรับเฉพาะไฟล์ PDF เท่านั้น'], 400);
        }

        $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
        $destPath = save_uploaded_pdf_file($file['tmp_name'], $uniqueFileName);
        $localFilePath = 'data/uploads/' . $uniqueFileName;
        $stampedFilePath = $localFilePath;
        $fileReplaced = true;

        // Delete previous local files (active & stamped) after backup snapshot was created
        $oldLocal = $existing['local_file_path'];
        $oldStamped = $existing['stamped_file_path'] ?? null;
        $oldDriveId = $existing['google_drive_file_id'];

        if (!empty($oldLocal) && $oldLocal !== $localFilePath) {
            delete_local_pdf_if_exists($oldLocal);
        }
        if (!empty($oldStamped) && $oldStamped !== $localFilePath && $oldStamped !== $oldLocal) {
            delete_local_pdf_if_exists($oldStamped);
        }

        // Upload new file to Google Drive & remove old Drive file
        try {
            $driveRes = uploadViaGoogleScript($destPath, $originalName, $tDept, $tName, $oldDriveId);
            if (!$driveRes) {
                $token = getGoogleAccessToken();
                if ($token) {
                    $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
                    $driveRes = uploadFileToGoogleDrive($token, $destPath, $originalName, $rootFolderId, $tDept, $tName);
                }
            }
            if ($driveRes && !empty($driveRes['fileId'])) {
                $driveFileId = $driveRes['fileId'];
                $driveViewLink = $driveRes['webViewLink'];
                $driveDownloadLink = $driveRes['downloadLink'];
                if (!empty($oldDriveId) && $oldDriveId !== $driveFileId) {
                    deleteGoogleDriveFile($oldDriveId);
                }
            }
        } catch (Exception $e) {}
    }

    if ($isR2Rev && $existing['submission_status'] === 'approved') {
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
                stamped_file_path = ?,
                google_drive_file_id = ?,
                google_drive_view_link = ?,
                google_drive_download_link = ?,
                round_2_signature = ?,
                round_2_signed_at = NOW(),
                round_2_status = 'submitted',
                round_2_stage = 'dept_head',
                reviewer_feedback = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL,
                updated_at = NOW()
            WHERE id = ?
        ");
        $upd->execute([
            $tName, $tDept, $sCode, $sName, $gLevel,
            $originalName, $fileSize, $localFilePath, $stampedFilePath,
            $driveFileId, $driveViewLink, $driveDownloadLink,
            $sigData, $planId
        ]);
        init_approval_timeline($pdo, $planId, $tName, 'dept_head', 'submitted', 2);
    } else {
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
                stamped_file_path = ?,
                google_drive_file_id = ?,
                google_drive_view_link = ?,
                google_drive_download_link = ?,
                signature_data = ?,
                submission_status = 'submitted',
                current_stage = 'dept_head',
                current_reviewer_title = 'หัวหน้ากลุ่มสาระการเรียนรู้',
                reviewer_feedback = NULL,
                reviewed_by = NULL,
                reviewed_at = NULL,
                updated_at = NOW()
            WHERE id = ?
        ");
        $upd->execute([
            $tName, $tDept, $sCode, $sName, $gLevel,
            $originalName, $fileSize, $localFilePath, $stampedFilePath,
            $driveFileId, $driveViewLink, $driveDownloadLink,
            $sigData, $planId
        ]);
        init_approval_timeline($pdo, $planId, $tName, 'dept_head', 'submitted', 1);
    }

    json_resp([
        'success' => true,
        'message' => $fileReplaced
            ? 'ลบไฟล์เดิมออกและบันทึกไฟล์แผนการสอนใหม่เรียบร้อยแล้ว ระบบได้ส่งเข้าตรวจใหม่แล้ว'
            : 'บันทึกข้อมูลแผนการสอนฉบับปรับปรุงเรียบร้อยแล้ว',
        'planId' => $planId,
        'fileReplaced' => $fileReplaced,
        'versionNumber' => ($snapInfo ? $snapInfo['versionNumber'] + 1 : 2),
        'driveViewLink' => $driveViewLink
    ]);
}

// 9.1b POST /api/plans/:id/snapshot (Create Version Snapshot Before Editing)
if ($method === 'POST' && preg_match('#^/plans/([^/]+)/snapshot$#', $path, $matches)) {
    $planId = $matches[1];
    $b = get_json_body();
    $reason = trim($_POST['reason'] ?? $b['reason'] ?? 'ก่อนเริ่มแก้ไขแผนการสอน');
    $snap = create_plan_snapshot($pdo, $planId, $reason);
    if (!$snap) {
        json_resp(['success' => false, 'message' => 'ไม่พบข้อมูลแผนการสอนที่ต้องการบันทึกประวัติ'], 404);
    }
    json_resp([
        'success' => true,
        'message' => "บันทึกสำรองประวัติเวอร์ชัน {$snap['versionNumber']} เรียบร้อยแล้ว",
        'data' => $snap
    ]);
}

// 9.1c GET /api/plans/:id/versions (List Version History)
if ($method === 'GET' && preg_match('#^/plans/([^/]+)/versions$#', $path, $matches)) {
    $planId = $matches[1];
    ensure_plan_versions_table($pdo);
    $stmt = $pdo->prepare("SELECT * FROM lesson_plan_versions WHERE lesson_plan_id = ? ORDER BY version_number DESC");
    $stmt->execute([$planId]);
    $list = $stmt->fetchAll();
    foreach ($list as &$ver) {
        unset($ver['signature_data']);
    }
    unset($ver);
    json_resp(['success' => true, 'data' => $list]);
}

// 9.2 DELETE /api/plans/:id or /api/admin/plans/:id (Delete Plan from DB, local disk, and Google Drive)
if ($method === 'DELETE' && preg_match('#^/(?:admin/)?plans/([^/]+)$#', $path, $matches)) {
    $planId = $matches[1];
    $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) {
        json_resp(['success' => false, 'message' => 'ไม่พบข้อมูลแผนการสอนที่ต้องการลบ'], 404);
    }

    $teacherName = $plan['teacher_name'] ?? 'ครูผู้สอน';
    $subjectCode = $plan['subject_code'] ?? 'แผนการสอน';

    // 1. Delete file on Google Drive if exists
    $driveDeleted = false;
    if (!empty($plan['google_drive_file_id'])) {
        try {
            $driveDeleted = deleteGoogleDriveFile($plan['google_drive_file_id']);
        } catch (Exception $e) {}
    }

    // 2. Delete local uploaded & stamped files
    $localFiles = array_filter([$plan['local_file_path'] ?? null, $plan['stamped_file_path'] ?? null]);
    foreach ($localFiles as $rel) {
        if (!empty($rel)) {
            delete_local_pdf_if_exists($rel);
        }
    }

    // 3. Delete approval timeline records
    $delTimeline = $pdo->prepare("DELETE FROM approval_timeline WHERE lesson_plan_id = ?");
    $delTimeline->execute([$planId]);

    // 4. Delete lesson plan record
    $delPlan = $pdo->prepare("DELETE FROM lesson_plans WHERE id = ?");
    $delPlan->execute([$planId]);

    json_resp([
        'success' => true,
        'message' => "ลบแผนการสอนวิชา {$subjectCode} ของ \"{$teacherName}\" ทั้งในฐานข้อมูลและบน Google Drive เรียบร้อยแล้ว",
        'planId' => $planId,
        'driveDeleted' => $driveDeleted
    ]);
}

// 9.3 POST /api/plans/:id/sync-drive or /api/admin/plans/:id/sync-drive (Force sync single plan to Google Drive)
if ($method === 'POST' && preg_match('#^/(?:admin/)?plans/([^/]+)/sync-drive$#', $path, $matches)) {
    @set_time_limit(180);
    $planId = $matches[1];
    $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) {
        json_resp(['success' => false, 'message' => 'ไม่พบข้อมูลแผนการสอน'], 404);
    }

    $ok = syncPlanToGoogleDriveIfMissing($pdo, $plan);
    if ($ok && !empty($plan['google_drive_view_link'])) {
        json_resp([
            'success' => true,
            'message' => 'อัปโหลดและซิงค์ไฟล์ขึ้น Google Drive เรียบร้อยแล้ว',
            'webViewLink' => $plan['google_drive_view_link'],
            'fileId' => $plan['google_drive_file_id']
        ]);
    } else {
        $relPath = !empty($plan['stamped_file_path']) ? $plan['stamped_file_path'] : ($plan['local_file_path'] ?? '');
        $fullPath = find_existing_local_pdf($relPath);
        $fileExists = !empty($fullPath);
        json_resp([
            'success' => false,
            'message' => $fileExists 
                ? 'ไม่สามารถอัปโหลดขึ้น Google Drive ได้ในขณะนี้ (กรุณาตรวจสอบการตั้งค่า Drive หรือลองใหม่อีกครั้ง)' 
                : 'ไม่พบไฟล์ PDF ในระบบ กรุณาให้ครูผู้สอนแนบไฟล์ส่งใหม่อีกครั้ง'
        ], 400);
    }
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
    $rows = $stmt->fetchAll();

    $planIds = array_column($rows, 'id');
    $timelinesByPlanRound = [];
    if (!empty($planIds)) {
        $inClause = implode(',', array_fill(0, count($planIds), '?'));
        $tlStmt = $pdo->prepare("SELECT id, lesson_plan_id, step_order, stage_key, stage_title, reviewer_name, reviewer_role, status, feedback, action_at, round_number FROM approval_timeline WHERE lesson_plan_id IN ($inClause) ORDER BY step_order ASC");
        $tlStmt->execute($planIds);
        foreach ($tlStmt->fetchAll() as $st) {
            $pid = $st['lesson_plan_id'];
            $rn = intval($st['round_number'] ?? 1) === 2 ? 2 : 1;
            $timelinesByPlanRound[$pid][$rn][] = $st;
        }
    }

    foreach ($rows as &$r) {
        unset($r['signature_data'], $r['round_2_signature']);
        $pid = $r['id'];
        $t1 = $timelinesByPlanRound[$pid][1] ?? [];
        if (empty($t1)) {
            $stageOrderMap = ['dept_head' => 1, 'curriculum_head' => 2, 'academic_director' => 3, 'director' => 4, 'completed' => 5];
            $subStatus = $r['submission_status'] ?? 'submitted';
            $curOrder = $subStatus === 'approved' ? 5 : ($stageOrderMap[$r['current_stage'] ?? 'dept_head'] ?? 1);
            $defs = [
                ['step_order' => 1, 'stage_key' => 'dept_head', 'stage_title' => '1. หัวหน้ากลุ่มสาระ'],
                ['step_order' => 2, 'stage_key' => 'curriculum_head', 'stage_title' => '2. หัวหน้างานหลักสูตร'],
                ['step_order' => 3, 'stage_key' => 'academic_director', 'stage_title' => '3. รองผู้อำนวยการฝ่ายวิชาการ'],
                ['step_order' => 4, 'stage_key' => 'director', 'stage_title' => '4. ผู้อำนวยการ']
            ];
            foreach ($defs as $d) {
                $st = 'waiting';
                if ($subStatus === 'approved' || $d['step_order'] < $curOrder) $st = 'completed';
                elseif ($d['step_order'] === $curOrder) $st = ($subStatus === 'revision_needed' ? 'revision_needed' : 'in_progress');
                $t1[] = [
                    'step_order' => $d['step_order'],
                    'stage_key' => $d['stage_key'],
                    'stage_title' => $d['stage_title'],
                    'reviewer_name' => null,
                    'status' => $st,
                    'feedback' => ($st === 'revision_needed' ? ($r['reviewer_feedback'] ?? null) : null)
                ];
            }
        }
        $t2 = $timelinesByPlanRound[$pid][2] ?? [];
        $r['timeline_round_1'] = $t1;
        $r['timeline_round_2'] = $t2;
        $hasRound2 = (intval($r['current_round'] ?? 1) === 2 || (!empty($r['round_2_status']) && $r['round_2_status'] !== 'not_started'));
        $r1Approved = (($r['submission_status'] ?? '') === 'approved');
        $activeRound = ($r1Approved && $hasRound2) ? 2 : 1;
        $r['timeline'] = ($activeRound === 2 && !empty($t2)) ? $t2 : $t1;
    }
    unset($r);
    json_resp(['success' => true, 'data' => $rows]);
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
    unset($plan['signature_data'], $plan['round_2_signature']);
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
    unset($plan['signature_data'], $plan['round_2_signature']);

    $t1Stmt = $pdo->prepare("
        SELECT * FROM approval_timeline 
        WHERE lesson_plan_id = ? AND (round_number = 1 OR round_number IS NULL)
        ORDER BY step_order ASC
    ");
    $t1Stmt->execute([$planId]);
    $timelineRound1 = $t1Stmt->fetchAll();

    // If timeline doesn't exist yet or is less than 4 steps, initialize it on the fly
    if (empty($timelineRound1) || count($timelineRound1) < 4) {
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

    if ((!empty($plan['round_2_status']) && $plan['round_2_status'] !== 'not_started') && (empty($timelineRound2) || count($timelineRound2) < 4)) {
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

    $driveViewLink = $p['google_drive_view_link'] ?? null;

    if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['pdf_file'];
        $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
        $destPath = save_uploaded_pdf_file($file['tmp_name'], $uniqueFileName);
        $newLocalPath = 'data/uploads/' . $uniqueFileName;

        if (!empty($p['local_file_path']) && $p['local_file_path'] !== $newLocalPath) {
            delete_local_pdf_if_exists($p['local_file_path']);
        }
        $oldDriveIdR2 = $p['google_drive_file_id'] ?? null;

        try {
            $r2OrigName = $p['file_original_name'] ?: 'lesson_plan.pdf';
            $r2Dept = $p['teacher_department'] ?: 'ทั่วไป';
            $r2Teacher = $p['teacher_name'] ?: 'ครูผู้สอน';
            $driveRes = uploadViaGoogleScript($destPath, $r2OrigName, $r2Dept, $r2Teacher, null);
            if (!$driveRes) {
                $token = getGoogleAccessToken();
                if ($token) {
                    $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
                    $driveRes = uploadFileToGoogleDrive($token, $destPath, $r2OrigName, $rootFolderId, $r2Dept, $r2Teacher);
                }
            }
            if ($driveRes && !empty($driveRes['fileId'])) {
                $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ?, google_drive_file_id = ?, google_drive_view_link = ?, google_drive_download_link = ? WHERE id = ?");
                $upd->execute([$newLocalPath, $newLocalPath, $driveRes['fileId'], $driveRes['webViewLink'], $driveRes['downloadLink'], $planId]);
                $driveViewLink = $driveRes['webViewLink'];
                if (!empty($oldDriveIdR2) && $oldDriveIdR2 !== $driveRes['fileId']) {
                    deleteGoogleDriveFile($oldDriveIdR2);
                }
            } else {
                $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ? WHERE id = ?");
                $upd->execute([$newLocalPath, $newLocalPath, $planId]);
            }
        } catch (Exception $e) {
            $upd = $pdo->prepare("UPDATE lesson_plans SET local_file_path = ?, stamped_file_path = ? WHERE id = ?");
            $upd->execute([$newLocalPath, $newLocalPath, $planId]);
        }
    }

    init_approval_timeline($pdo, $planId, $p['teacher_name'] ?? 'ครูผู้สอน', 'dept_head', 'submitted', 2);
    json_resp([
        'success' => true,
        'message' => 'บันทึกการส่งและลงนามครั้งที่ 2 สำเร็จ',
        'driveViewLink' => $driveViewLink
    ]);
}

// 14. GET /api/admin/plans (Reviewer Dashboard List)
if ($method === 'GET' && $path === '/admin/plans') {
    $stage = $_GET['stage'] ?? null;
    $dept = $_GET['department'] ?? null;
    $term = $_GET['term_id'] ?? $_GET['term'] ?? null;
    $search = $_GET['search'] ?? null;
    $filterMode = $_GET['filter_mode'] ?? 'all';
    $reviewerRole = $_GET['reviewer_role'] ?? null;
    $reviewerDept = $_GET['reviewer_dept'] ?? null;

    $sql = "
        SELECT lp.*, at.name as term_name, at.code as term_code 
        FROM lesson_plans lp
        LEFT JOIN academic_terms at ON lp.academic_term_id = at.id
        WHERE 1=1
    ";
    $params = [];

    if ($term && $term !== 'all') {
        $sql .= " AND lp.academic_term_id = ?";
        $params[] = $term;
    }

    // Role scoping: dept_head can only see their department
    if ($reviewerRole === 'dept_head' && !empty($reviewerDept)) {
        $sql .= " AND lp.teacher_department = ?";
        $params[] = $reviewerDept;
    } elseif ($dept && $dept !== 'all') {
        $sql .= " AND lp.teacher_department = ?";
        $params[] = $dept;
    }

    if ($search) {
        $sql .= " AND (lp.teacher_name LIKE ? OR lp.teacher_email LIKE ? OR lp.subject_name LIKE ? OR lp.subject_code LIKE ?)";
        $sTerm = "%{$search}%";
        $params[] = $sTerm;
        $params[] = $sTerm;
        $params[] = $sTerm;
        $params[] = $sTerm;
    }

    $sql .= " ORDER BY lp.created_at DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $allPlans = $stmt->fetchAll();

    // Fetch timeline steps for all plans in bulk
    $planIds = array_column($allPlans, 'id');
    $timelinesByPlanRound = [];
    if (!empty($planIds)) {
        $inClause = implode(',', array_fill(0, count($planIds), '?'));
        $tlStmt = $pdo->prepare("SELECT id, lesson_plan_id, step_order, stage_key, stage_title, reviewer_name, reviewer_role, status, feedback, action_at, round_number FROM approval_timeline WHERE lesson_plan_id IN ($inClause) ORDER BY step_order ASC");
        $tlStmt->execute($planIds);
        $allTlSteps = $tlStmt->fetchAll();
        foreach ($allTlSteps as $st) {
            $pid = $st['lesson_plan_id'];
            $r = intval($st['round_number'] ?? 1) === 2 ? 2 : 1;
            $timelinesByPlanRound[$pid][$r][] = $st;
        }
    }

    $countMyTurn = 0;
    $countApproved = 0;
    $countWaitingOthers = 0;
    $countRevision = 0;
    $countTotal = count($allPlans);

    $filteredPlans = [];

    foreach ($allPlans as &$p) {
        unset($p['signature_data'], $p['round_2_signature']);
        $pid = $p['id'];
        $hasRound2 = (intval($p['current_round']) === 2 || (!empty($p['round_2_status']) && $p['round_2_status'] !== 'not_started'));
        $r1Approved = ($p['submission_status'] === 'approved');
        $r2Approved = ($p['round_2_status'] === 'approved');
        $r1Revision = ($p['submission_status'] === 'revision_needed');
        $r2Revision = ($p['round_2_status'] === 'revision_needed');

        $t1 = $timelinesByPlanRound[$pid][1] ?? [];
        $t2 = $timelinesByPlanRound[$pid][2] ?? [];
        $p['timeline_round_1'] = $t1;
        $p['timeline_round_2'] = $t2;

        // Active round for reviewer focus
        $activeRound = ($r1Approved && $hasRound2) ? 2 : 1;
        $activeStatus = $activeRound === 2 ? ($p['round_2_status'] ?? 'submitted') : ($p['submission_status'] ?? 'submitted');
        $activeStage = $activeRound === 2 ? ($p['round_2_stage'] ?? 'dept_head') : ($p['current_stage'] ?? 'dept_head');
        $p['active_round'] = $activeRound;
        $p['active_status'] = $activeStatus;
        $p['active_stage'] = $activeStage;
        $p['timeline'] = ($activeRound === 2 && !empty($t2)) ? $t2 : $t1;

        // Check if it's my turn
        $isMyTurnR1 = in_array($p['submission_status'], ['submitted', 'under_review']) && 
                      ($reviewerRole === 'admin' || $p['current_stage'] === $reviewerRole);
        $isMyTurnR2 = $hasRound2 && in_array($p['round_2_status'], ['submitted', 'under_review']) && 
                      ($reviewerRole === 'admin' || ($p['round_2_stage'] ?? 'dept_head') === $reviewerRole);

        $isMyTurn = $isMyTurnR1 || $isMyTurnR2;

        // Overall status categorization for KPI counters
        $isFullyApproved = $hasRound2 ? ($r1Approved && $r2Approved) : $r1Approved;
        $isRevision = $r1Revision || $r2Revision;

        if ($isFullyApproved) {
            $countApproved++;
        } elseif ($isRevision) {
            $countRevision++;
        } elseif ($isMyTurn) {
            $countMyTurn++;
        } else {
            $countWaitingOthers++;
        }

        // Apply filter_mode
        $include = true;
        if ($filterMode === 'my_turn') {
            $include = $isMyTurn;
        } elseif ($filterMode === 'approved') {
            $include = $isFullyApproved;
        } elseif ($filterMode === 'revision') {
            $include = $isRevision;
        } elseif ($filterMode === 'waiting_others') {
            $include = (!$isFullyApproved && !$isRevision && !$isMyTurn);
        }

        if ($include) {
            $filteredPlans[] = $p;
        }
    }
    unset($p);

    json_resp([
        'success' => true,
        'data' => $filteredPlans,
        'counts' => [
            'my_turn' => $countMyTurn,
            'approved' => $countApproved,
            'waiting_others' => $countWaitingOthers,
            'revision' => $countRevision,
            'total' => $countTotal
        ]
    ]);
}

// 15. POST /api/admin/plans/:id/step-review (Tier progression)
if ($method === 'POST' && preg_match('#^/admin/plans/([^/]+)/step-review$#', $path, $matches)) {
    @set_time_limit(180);
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

    // Ensure Round 2 timeline exists in approval_timeline if reviewing Round 2
    if ($roundNumber === 2) {
        $chk2 = $pdo->prepare("SELECT COUNT(*) FROM approval_timeline WHERE lesson_plan_id = ? AND round_number = 2");
        $chk2->execute([$planId]);
        if ($chk2->fetchColumn() == 0) {
            $pNameStmt = $pdo->prepare("SELECT teacher_name, round_2_stage, round_2_status FROM lesson_plans WHERE id = ?");
            $pNameStmt->execute([$planId]);
            $pRow = $pNameStmt->fetch();
            init_approval_timeline($pdo, $planId, $pRow['teacher_name'] ?? 'ครูผู้สอน', $pRow['round_2_stage'] ?? 'dept_head', $pRow['round_2_status'] ?? 'submitted', 2);
        }
    }

    // If an updated stamped PDF was attached by client-side PDFLib
    if (isset($_FILES['pdf_file']) && $_FILES['pdf_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['pdf_file'];
        $uniqueFileName = 'plan_' . time() . '_' . substr(gen_uuid(), 0, 8) . '.pdf';
        $destPath = save_uploaded_pdf_file($file['tmp_name'], $uniqueFileName);
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
            delete_local_pdf_if_exists($oldLocalPath);
        }
        if (!empty($oldStampedPath) && $oldStampedPath !== $newLocalPath && $oldStampedPath !== $oldLocalPath) {
            delete_local_pdf_if_exists($oldStampedPath);
        }

        // 2. Upload new stamped PDF to Google Drive FIRST, then delete old file only after new upload succeeds
        try {
            $driveRes = uploadViaGoogleScript($destPath, $origName, $tDept, $tName, null);
            if (!$driveRes) {
                $token = getGoogleAccessToken();
                if ($token) {
                    $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
                    $driveRes = uploadFileToGoogleDrive($token, $destPath, $origName, $rootFolderId, $tDept, $tName);
                }
            }
            if ($driveRes && !empty($driveRes['fileId'])) {
                $driveFileId = $driveRes['fileId'];
                $driveViewLink = $driveRes['webViewLink'];
                $driveDownloadLink = $driveRes['downloadLink'];

                $updDrive = $pdo->prepare("
                    UPDATE lesson_plans 
                    SET stamped_file_path = ?, local_file_path = ?, google_drive_file_id = ?, google_drive_view_link = ?, google_drive_download_link = ? 
                    WHERE id = ?
                ");
                $updDrive->execute([$newLocalPath, $newLocalPath, $driveFileId, $driveViewLink, $driveDownloadLink, $planId]);

                if (!empty($oldDriveId) && $oldDriveId !== $driveFileId) {
                    deleteGoogleDriveFile($oldDriveId);
                }
            } else {
                $updLocal = $pdo->prepare("UPDATE lesson_plans SET stamped_file_path = ?, local_file_path = ? WHERE id = ?");
                $updLocal->execute([$newLocalPath, $newLocalPath, $planId]);
            }
        } catch (Exception $e) {
            $updLocal = $pdo->prepare("UPDATE lesson_plans SET stamped_file_path = ?, local_file_path = ? WHERE id = ?");
            $updLocal->execute([$newLocalPath, $newLocalPath, $planId]);
        }
    } else {
        // Ensure existing local PDF is synced to Google Drive if link is still missing
        $pDetailsStmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
        $pDetailsStmt->execute([$planId]);
        $pDetails = $pDetailsStmt->fetch();
        if ($pDetails && empty($pDetails['google_drive_view_link'])) {
            syncPlanToGoogleDriveIfMissing($pdo, $pDetails);
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

        if ($roundNumber === 2) {
            $updPlan = $pdo->prepare("
                UPDATE lesson_plans 
                SET round_2_status = 'revision_needed', reviewer_feedback = ?, reviewed_at = NOW(), reviewed_by = ? 
                WHERE id = ?
            ");
            $updPlan->execute([$feedback, $reviewerName, $planId]);
        } else {
            $updPlan = $pdo->prepare("
                UPDATE lesson_plans 
                SET submission_status = 'revision_needed', reviewer_feedback = ?, reviewed_at = NOW(), reviewed_by = ? 
                WHERE id = ?
            ");
            $updPlan->execute([$feedback, $reviewerName, $planId]);
        }

        $notifyInfo = send_revision_notifications(
            $pdo,
            $planId,
            $feedback ?: 'ส่งกลับเพื่อแก้ไข',
            $reviewerName,
            $reviewerRole,
            $roundNumber
        );

        json_resp([
            'success' => true,
            'message' => 'ส่งกลับแผนการสอนเพื่อแก้ไขปรับปรุงเรียบร้อย',
            'reason' => $feedback ?: 'ส่งกลับเพื่อแก้ไข',
            'notify' => $notifyInfo
        ]);
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
        if (@file_exists($p)) {
            $json = json_decode(@file_get_contents($p), true);
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
        if (@file_exists($envPath)) {
            $lines = @file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                if (strpos(trim($line), 'GOOGLE_SCRIPT_WEBAPP_URL=') === 0) {
                    $val = trim(substr(trim($line), strlen('GOOGLE_SCRIPT_WEBAPP_URL=')));
                    $val = trim($val, " \t\n\r\0\x0B\"'");
                    if (!empty($val)) $webAppUrl = $val;
                }
            }
        }
        if ($webAppUrl) {
            $delPayload = json_encode(['action' => 'delete', 'fileId' => $fileId]);
            $ch = curl_init($webAppUrl);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_HTTPHEADER, [
                'Content-Type: application/json; charset=utf-8',
                'Content-Length: ' . strlen($delPayload),
                'Expect:'
            ]);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $delPayload);
            curl_setopt($ch, CURLOPT_TIMEOUT, 20);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
            curl_exec($ch);
            curl_close($ch);
        }
    } catch (Exception $e) {}

    return true;
}

function uploadViaGoogleScript($filePath, $fileName, $department, $teacherName, $deleteFileId = null) {
    @set_time_limit(180);
    @ini_set('memory_limit', '512M');

    $envPath = __DIR__ . '/../../.env';
    $webAppUrl = 'https://script.google.com/macros/s/AKfycbwj0MbEaIonkYhTbiI0HbVV1SgzDU4GqtrVwyBI0Eld5MgcoORD1040myQX13djqwLH/exec';

    if (@file_exists($envPath)) {
        $lines = @file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            if (strpos(trim($line), 'GOOGLE_SCRIPT_WEBAPP_URL=') === 0) {
                $val = trim(substr(trim($line), strlen('GOOGLE_SCRIPT_WEBAPP_URL=')));
                $val = trim($val, " \t\n\r\0\x0B\"'");
                if (!empty($val)) $webAppUrl = $val;
            }
        }
    }

    if (!$webAppUrl || !@file_exists($filePath)) return null;

    $fileData = @file_get_contents($filePath);
    if ($fileData === false) return null;

    $postData = [
        'fileName' => $fileName ?: 'lesson_plan.pdf',
        'fileBase64' => base64_encode($fileData),
        'department' => $department ?: 'กลุ่มสาระทั่วไป',
        'teacherName' => $teacherName ?: 'ครูผู้สอน'
    ];
    if ($deleteFileId) {
        $postData['deleteFileId'] = $deleteFileId;
    }

    $jsonPayload = json_encode($postData, JSON_UNESCAPED_UNICODE);

    // Step 1: POST payload without CURLOPT_FOLLOWLOCATION inside curl_setopt_array
    // (Prevents open_basedir on shared hosting from aborting curl_setopt_array)
    $ch = curl_init($webAppUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HEADER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json; charset=utf-8',
        'Content-Length: ' . strlen($jsonPayload),
        'Expect:'
    ]);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonPayload);
    curl_setopt($ch, CURLOPT_TIMEOUT, 120);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 30);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LessonPlanSystem/1.0');

    $rawRes = curl_exec($ch);
    $httpCode = intval(curl_getinfo($ch, CURLINFO_HTTP_CODE));
    $headerSize = intval(curl_getinfo($ch, CURLINFO_HEADER_SIZE));
    $redirectUrl = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    $curlErr = curl_error($ch);
    curl_close($ch);

    $resHeaders = $rawRes !== false ? substr($rawRes, 0, $headerSize) : '';
    $resBody = $rawRes !== false ? substr($rawRes, $headerSize) : '';

    // Step 2: Manually follow 301/302/303/307/308 redirects via GET (up to 5 hops)
    $hops = 0;
    while (in_array($httpCode, [301, 302, 303, 307, 308]) && $hops < 5) {
        $hops++;
        if (empty($redirectUrl) && preg_match('/^Location:\s*(.+)$/mi', $resHeaders, $m)) {
            $redirectUrl = trim($m[1]);
        }
        if (empty($redirectUrl)) break;

        $ch2 = curl_init($redirectUrl);
        curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch2, CURLOPT_HEADER, true);
        curl_setopt($ch2, CURLOPT_HTTPGET, true);
        curl_setopt($ch2, CURLOPT_TIMEOUT, 90);
        curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 30);
        curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch2, CURLOPT_SSL_VERIFYHOST, 0);
        curl_setopt($ch2, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LessonPlanSystem/1.0');

        $rawRes2 = curl_exec($ch2);
        $httpCode = intval(curl_getinfo($ch2, CURLINFO_HTTP_CODE));
        $headerSize2 = intval(curl_getinfo($ch2, CURLINFO_HEADER_SIZE));
        $redirectUrl = curl_getinfo($ch2, CURLINFO_REDIRECT_URL);
        $curlErr = curl_error($ch2);
        curl_close($ch2);

        if ($rawRes2 === false) break;
        $resHeaders = substr($rawRes2, 0, $headerSize2);
        $resBody = substr($rawRes2, $headerSize2);
    }

    if ($resBody && $httpCode >= 200 && $httpCode < 400) {
        $data = json_decode(trim($resBody), true);
        if (!empty($data['success'])) {
            $fid = $data['fileId'] ?? ('gdrive_' . time());
            return [
                'fileId' => $fid,
                'webViewLink' => $data['webViewLink'] ?? "https://drive.google.com/file/d/{$fid}/view",
                'downloadLink' => $data['downloadLink'] ?? "https://drive.google.com/uc?export=download&id={$fid}"
            ];
        }
    }
    @file_put_contents(__DIR__ . '/../../data/gdrive_error.log', date('Y-m-d H:i:s') . " WebApp HTTP: {$httpCode} Hops: {$hops} Err: {$curlErr} Res: " . substr((string)$resBody, 0, 500) . "\n", FILE_APPEND);
    return null;
}

function syncPlanToGoogleDriveIfMissing($pdo, &$plan) {
    if (!empty($plan['google_drive_view_link']) && strpos($plan['google_drive_file_id'] ?? '', 'mock_') !== 0) {
        return false;
    }
    $relPath = !empty($plan['stamped_file_path']) ? $plan['stamped_file_path'] : ($plan['local_file_path'] ?? '');
    if (empty($relPath)) return false;

    $fullPath = find_existing_local_pdf($relPath);
    if (!$fullPath) return false;

    $origName = $plan['file_original_name'] ?: ('แผนการสอน_' . ($plan['subject_code'] ?? 'PDF') . '.pdf');
    $dept = $plan['teacher_department'] ?: 'กลุ่มสาระทั่วไป';
    $teacher = $plan['teacher_name'] ?: 'ครูผู้สอน';

    // 1. Try Google Apps Script Web App first
    $driveRes = uploadViaGoogleScript($fullPath, $origName, $dept, $teacher, null);

    // 2. Fallback to direct Service Account upload if Google Apps Script fails
    if (!$driveRes) {
        $token = getGoogleAccessToken();
        if ($token) {
            $rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
            $driveRes = uploadFileToGoogleDrive($token, $fullPath, $origName, $rootFolderId, $dept, $teacher);
        }
    }

    if ($driveRes && !empty($driveRes['fileId'])) {
        $upd = $pdo->prepare("UPDATE lesson_plans SET google_drive_file_id = ?, google_drive_view_link = ?, google_drive_download_link = ? WHERE id = ?");
        $upd->execute([$driveRes['fileId'], $driveRes['webViewLink'], $driveRes['downloadLink'], $plan['id']]);
        $plan['google_drive_file_id'] = $driveRes['fileId'];
        $plan['google_drive_view_link'] = $driveRes['webViewLink'];
        $plan['google_drive_download_link'] = $driveRes['downloadLink'];
        return true;
    }
    return false;
}

function uploadFileToGoogleDrive($token, $filePath, $fileName, $targetFolderId = null, $department = '', $teacherName = '') {
    // Direct Resumable Upload via Google Drive API (Service Account Fallback)
    if (!$token || !file_exists($filePath)) return null;

    // Resolve Department -> Teacher subfolder hierarchy if provided
    $parentFolderId = $targetFolderId;
    if ($department) {
        $deptFld = getOrCreateGoogleDriveFolder($token, $department, $parentFolderId);
        if ($deptFld && !empty($deptFld['id'])) {
            $parentFolderId = $deptFld['id'];
            if ($teacherName) {
                $teacherFld = getOrCreateGoogleDriveFolder($token, $teacherName, $parentFolderId);
                if ($teacherFld && !empty($teacherFld['id'])) {
                    $parentFolderId = $teacherFld['id'];
                }
            }
        }
    }

    $fileSize = filesize($filePath);
    $mimeType = 'application/pdf';

    $metadata = [
        'name' => $fileName,
        'mimeType' => $mimeType
    ];
    if ($parentFolderId) {
        $metadata['parents'] = [$parentFolderId];
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
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0
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

    $fileData = @file_get_contents($filePath);
    if ($fileData === false) return null;

    // Step 2: Stream Data to Location via PUT (clean POSTFIELDS buffer without chunked upload issues)
    $ch = curl_init($uploadLocation);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_POSTFIELDS => $fileData,
        CURLOPT_HTTPHEADER => [
            "Content-Length: {$fileSize}",
            "Content-Type: {$mimeType}"
        ],
        CURLOPT_TIMEOUT => 120,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0
    ]);
    $uploadRes = curl_exec($ch);
    $uploadHttp = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $uploadErr = curl_error($ch);
    curl_close($ch);

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

    @file_put_contents(__DIR__ . '/../../data/gdrive_error.log', date('Y-m-d H:i:s') . " PUT Upload HTTP: {$uploadHttp} Err: {$uploadErr} Res: " . substr((string)$uploadRes, 0, 500) . "\n", FILE_APPEND);
    return null;
}


// 20.5 Notification Settings & Test Endpoints (Gmail & Telegram)
if ($method === 'GET' && $path === '/admin/notifications/settings') {
    $s = get_notification_settings();
    $adminEmails = [];
    try {
        $admStmt = $pdo->query("SELECT name, email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != ''");
        if ($admStmt) {
            $adminEmails = $admStmt->fetchAll();
        }
    } catch (Exception $e) {}

    json_resp([
        'success' => true,
        'data' => [
            'admin_email' => $s['admin_email'],
            'smtp_user' => $s['smtp_user'],
            'has_smtp_pass' => !empty($s['smtp_pass']),
            'smtp_pass_masked' => !empty($s['smtp_pass']) ? '••••••••' : '',
            'telegram_bot_token' => $s['telegram_bot_token'],
            'telegram_chat_id' => $s['telegram_chat_id'],
            'admin_users' => $adminEmails
        ]
    ]);
}

if ($method === 'POST' && $path === '/admin/notifications/settings') {
    $b = get_json_body();
    $current = get_notification_settings();
    $submittedPass = isset($b['smtp_pass']) ? trim((string)$b['smtp_pass']) : '';
    $newPass = ($submittedPass === '••••••••') ? $current['smtp_pass'] : $submittedPass;

    $newSettings = [
        'admin_email' => trim((string)($b['admin_email'] ?? $current['admin_email'])),
        'smtp_user' => trim((string)($b['smtp_user'] ?? $current['smtp_user'])),
        'smtp_pass' => $newPass,
        'telegram_bot_token' => trim((string)($b['telegram_bot_token'] ?? $current['telegram_bot_token'])),
        'telegram_chat_id' => trim((string)($b['telegram_chat_id'] ?? $current['telegram_chat_id']))
    ];

    if (save_notification_settings($newSettings)) {
        json_resp(['success' => true, 'message' => 'บันทึกการตั้งค่าแจ้งเตือน Gmail และ Telegram เรียบร้อยแล้ว']);
    } else {
        json_resp(['success' => false, 'message' => 'ไม่สามารถเขียนไฟล์ตั้งค่าได้ (ตรวจสอบสิทธิ์โฟลเดอร์ uploads)'], 500);
    }
}

if ($method === 'POST' && $path === '/admin/notifications/test') {
    $b = get_json_body();
    $current = get_notification_settings();
    $submittedPass = isset($b['smtp_pass']) ? trim((string)$b['smtp_pass']) : '';
    $testSettings = [
        'admin_email' => trim((string)($b['admin_email'] ?? $current['admin_email'])),
        'smtp_user' => trim((string)($b['smtp_user'] ?? $current['smtp_user'])),
        'smtp_pass' => ($submittedPass === '••••••••' || $submittedPass === '') ? $current['smtp_pass'] : $submittedPass,
        'telegram_bot_token' => trim((string)($b['telegram_bot_token'] ?? $current['telegram_bot_token'])),
        'telegram_chat_id' => trim((string)($b['telegram_chat_id'] ?? $current['telegram_chat_id']))
    ];

    $rawEmails = [];
    try {
        $admStmt = $pdo->query("SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email != ''");
        if ($admStmt) {
            foreach ($admStmt->fetchAll() as $adm) {
                if (!empty($adm['email'])) $rawEmails[] = $adm['email'];
            }
        }
    } catch (Exception $e) {}
    if (!empty($testSettings['admin_email'])) {
        foreach (preg_split('/[,;\s]+/', $testSettings['admin_email']) as $extra) {
            if (!empty($extra)) $rawEmails[] = $extra;
        }
    }
    $recipients = [];
    foreach ($rawEmails as $em) {
        $emClean = strtolower(trim((string)$em));
        if (filter_var($emClean, FILTER_VALIDATE_EMAIL)) {
            $recipients[$emClean] = $emClean;
        }
    }
    $recipients = array_values($recipients);

    $emailRes = ['success' => false, 'error' => 'ยังไม่มีอีเมลปลายทางของ Admin', 'method' => 'none'];
    $testSubject = '[ทดสอบระบบแจ้งเตือน] การตีกลับแผนการสอน • โรงเรียนสระหลวงพิทยาคม';
    $testHtml = '<div style="font-family:Tahoma,sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;">'
              . '<h3 style="color:#dc2626;margin-top:0;">🔔 ทดสอบการแจ้งเตือนตีกลับแผนการสอน</h3>'
              . '<p>ระบบส่งการแจ้งเตือนผ่านอีเมลทำงานปกติแล้ว (Admin และครูผู้โดนตีกลับจะได้รับอีเมลรูปแบบนี้ทุกครั้งเมื่อมีการตีกลับแผน)</p>'
              . '<div style="background:#fef2f2;padding:12px;border-left:4px solid #dc2626;"><strong>ตัวอย่างสาเหตุที่ตีกลับ:</strong> กรุณาเพิ่มเติมใบงานท้ายแผนการเรียนรู้</div>'
              . '</div>';

    if (!empty($recipients)) {
        if (!empty($testSettings['smtp_user']) && !empty($testSettings['smtp_pass'])) {
            $emailRes = send_smtp_gmail($testSettings['smtp_user'], $testSettings['smtp_pass'], $recipients, $testSubject, $testHtml);
            $emailRes['method'] = 'gmail_smtp';
        } else {
            $encodedSub = '=?UTF-8?B?' . base64_encode($testSubject) . '?=';
            $fromEmail = $testSettings['smtp_user'] ?: ('noreply@' . ($_SERVER['HTTP_HOST'] ?? 'school.local'));
            $mailHeaders = "MIME-Version: 1.0\r\nContent-type: text/html; charset=UTF-8\r\nFrom: ระบบส่งแผนการสอน <{$fromEmail}>\r\n";
            $anySent = false;
            foreach ($recipients as $rcpt) {
                if (@mail($rcpt, $encodedSub, $testHtml, $mailHeaders)) $anySent = true;
            }
            $emailRes = [
                'success' => $anySent,
                'method' => 'php_mail',
                'error' => $anySent ? null : 'กรุณากรอก Gmail ผู้ส่ง และ รหัสผ่านแอป (App Password)'
            ];
        }
    }

    $tgRes = ['success' => false, 'error' => 'ยังไม่ได้ระบุ Telegram Bot Token / Chat ID'];
    if (!empty($testSettings['telegram_bot_token']) && !empty($testSettings['telegram_chat_id'])) {
        $tgTestMsg = "🔔 <b>ทดสอบแจ้งเตือนตีกลับแผนการสอน</b>\n"
                   . "━━━━━━━━━━━━━━━━\n"
                   . "✅ เชื่อมต่อบอท Telegram สำเร็จ!\n"
                   . "📌 <b>ตัวอย่างสาเหตุ:</b>\n<blockquote>กรุณาเพิ่มเติมจุดประสงค์การเรียนรู้และใบงาน</blockquote>";
        $tgRes = send_telegram_alert($testSettings['telegram_bot_token'], $testSettings['telegram_chat_id'], $tgTestMsg);
    }

    json_resp([
        'success' => ($emailRes['success'] || $tgRes['success']),
        'recipients' => $recipients,
        'email' => $emailRes,
        'telegram' => $tgRes
    ]);
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

    // 3. Also auto-sync any lesson plans that have a local PDF file but are missing google_drive_view_link
    $missingStmt = $pdo->query("SELECT * FROM lesson_plans WHERE (google_drive_view_link IS NULL OR google_drive_view_link = '')");
    $missingPlans = $missingStmt->fetchAll();
    $syncedPlansCount = 0;
    foreach ($missingPlans as $mp) {
        if (syncPlanToGoogleDriveIfMissing($pdo, $mp)) {
            $syncedPlansCount++;
        }
    }

    $syncMsg = "ซิงค์โครงสร้างโฟลเดอร์สำเร็จ: สร้าง/ตรวจพบกลุ่มสาระฯ {$departmentsCreated} หมวด และครู {$teachersCreated} ท่าน";
    if ($syncedPlansCount > 0) {
        $syncMsg .= " (อัปโหลดไฟล์ PDF ที่ค้างขึ้น Google Drive สำเร็จ {$syncedPlansCount} แผน)";
    }

    json_resp([
        'success' => true,
        'message' => $syncMsg,
        'data' => [
            'totalDepartments' => count($departments),
            'totalTeachers' => count($allTeachers),
            'departmentsCreated' => $departmentsCreated,
            'teachersCreated' => $teachersCreated,
            'syncedPlansCount' => $syncedPlansCount,
            'tree' => $tree
        ]
    ]);
}

// 22.9. GET /api/templates/download
if ($method === 'GET' && $path === '/templates/download') {
    $candidates = [
        __DIR__ . '/../templates/เทมเพลต_นท1_นท2.docx',
        __DIR__ . '/../../data/templates/เทมเพลต_นท1_นท2.docx',
        __DIR__ . '/../../test/เทมเพลต_นท1_นท2 (1).docx'
    ];
    foreach ($candidates as $tplPath) {
        if (@file_exists($tplPath)) {
            while (ob_get_level() > 0) { @ob_end_clean(); }
            $dlName = 'เทมเพลต_นท1_นท2.docx';
            header('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            header('Content-Disposition: attachment; filename="template_nt1_nt2.docx"; filename*=UTF-8\'\'' . rawurlencode($dlName));
            header('Content-Length: ' . filesize($tplPath));
            readfile($tplPath);
            exit;
        }
    }
    while (ob_get_level() > 0) { @ob_end_clean(); }
    http_response_code(404);
    die('ไม่พบไฟล์เทมเพลต');
}

// 23. GET /api/files/download/:id
if ($method === 'GET' && preg_match('#^/files/download/([^/]+)$#', $path, $matches)) {
    $planId = $matches[1];
    $stmt = $pdo->prepare("SELECT * FROM lesson_plans WHERE id = ?");
    $stmt->execute([$planId]);
    $plan = $stmt->fetch();
    if (!$plan) {
        while (ob_get_level() > 0) { @ob_end_clean(); }
        http_response_code(404);
        die('ไม่พบข้อมูลแผนการสอน');
    }

    $fullPath = resolve_plan_pdf_path($plan);

    if (!$fullPath || !@file_exists($fullPath)) {
        while (ob_get_level() > 0) { @ob_end_clean(); }
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

    while (ob_get_level() > 0) { @ob_end_clean(); }
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
        while (ob_get_level() > 0) { @ob_end_clean(); }
        http_response_code(404);
        die('ไม่พบข้อมูลแผนการสอน');
    }

    $fullPath = resolve_plan_pdf_path($plan);

    if (!$fullPath || !@file_exists($fullPath)) {
        while (ob_get_level() > 0) { @ob_end_clean(); }
        if (!empty($plan['google_drive_view_link'])) {
            $viewUrl = $plan['google_drive_view_link'];
            // Convert /view to /preview so it renders cleanly inside iframes as well
            $previewUrl = preg_replace('#/view(\?.*)?$#', '/preview', $viewUrl);
            header('Location: ' . $previewUrl);
            exit;
        }
        header('Content-Type: text/html; charset=utf-8');
        http_response_code(200);
        echo '<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><title>ไม่พบไฟล์ PDF</title>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Prompt:wght@400;600&display=swap" rel="stylesheet">';
        echo '<style>body{font-family:"Prompt",sans-serif;background:#f8fafc;color:#334155;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;text-align:center;}.box{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px 24px;max-width:460px;box-shadow:0 4px 15px rgba(0,0,0,0.05);}h3{color:#dc2626;margin:0 0 10px;font-size:1.15rem;}p{font-size:0.9rem;line-height:1.6;color:#64748b;margin:0;}</style></head>';
        echo '<body><div class="box"><h3>⚠️ ไม่พบไฟล์ PDF บนเซิร์ฟเวอร์</h3><p>แผนการสอนรายวิชานี้ถูกส่งเข้ามาก่อนที่จะเปิดสิทธิ์โฟลเดอร์จัดเก็บไฟล์บนเซิร์ฟเวอร์<br><br><strong>วิธีแก้ไข:</strong> กรุณาให้ครูผู้สอนกดปุ่ม <strong>"แก้ไข"</strong> ในหน้าส่งแผน หรือหน้าสถานะของฉัน แล้วแนบไฟล์ PDF ส่งใหม่อีกครั้ง ระบบจะบันทึกไฟล์พร้อมซิงค์ขึ้น Google Drive ทันทีครับ</p></div></body></html>';
        exit;
    }

    while (ob_get_level() > 0) { @ob_end_clean(); }
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="' . rawurlencode($plan['file_original_name'] ?: 'lesson_plan.pdf') . '"');
    header('Content-Length: ' . filesize($fullPath));
    readfile($fullPath);
    exit;
}

// Fallback: 404 Not Found
json_resp(['success' => false, 'message' => "API endpoint not found: {$method} {$path}"], 404);

