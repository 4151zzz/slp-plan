<?php
header('Content-Type: text/html; charset=utf-8');
echo "<h2>Google Drive Upload Diagnostic Tool (V3 - Resumable Real Test)</h2>";

function getCreds() {
    $candidates = [
        __DIR__ . '/../credentials/service-account.json',
        __DIR__ . '/../../credentials/service-account.json',
        __DIR__ . '/credentials/service-account.json',
        dirname(__DIR__, 2) . '/credentials/service-account.json'
    ];
    foreach ($candidates as $p) {
        if (file_exists($p)) {
            $json = json_decode(file_get_contents($p), true);
            if ($json && !empty($json['client_email']) && !empty($json['private_key'])) {
                return ['cred' => $json, 'path' => $p];
            }
        }
    }
    return null;
}

$cData = getCreds();
$cred = $cData['cred'];
echo "1. Service Account: <b>{$cred['client_email']}</b><br>";

// Get Access Token
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
openssl_sign($sigPayload, $signature, $cred['private_key'], OPENSSL_ALGO_SHA256);
$jwt = $sigPayload . '.' . $b64Url($signature);

$ch = curl_init('https://oauth2.googleapis.com/token');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POSTFIELDS => http_build_query([
        'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        'assertion' => $jwt
    ]),
    CURLOPT_TIMEOUT => 15
]);
$tokenRes = curl_exec($ch);
curl_close($ch);
$tokenJson = json_decode($tokenRes, true);
$accessToken = $tokenJson['access_token'] ?? null;

$rootFolderId = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';
echo "2. Target Shared Drive Folder ID: <b>{$rootFolderId}</b><br>";

// FULL 2-STEP RESUMABLE UPLOAD TEST
echo "<h3>Executing 2-Step Resumable Upload Test...</h3>";
$dummyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF";
$fileSize = strlen($dummyPdf);

$metadata = [
    'name' => 'Diagnostic_Success_Test_' . date('Y-m-d_His') . '.pdf',
    'mimeType' => 'application/pdf',
    'parents' => [$rootFolderId]
];

// Step 1: Session Init
$initUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink';
$ch = curl_init($initUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        "Authorization: Bearer {$accessToken}",
        "Content-Type: application/json; charset=UTF-8",
        "X-Upload-Content-Type: application/pdf",
        "X-Upload-Content-Length: {$fileSize}"
    ],
    CURLOPT_POSTFIELDS => json_encode($metadata),
    CURLOPT_TIMEOUT => 30
]);
$initRes = curl_exec($ch);
$initHttp = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "Step 1 (Session Init) HTTP: <b>{$initHttp}</b><br>";

$uploadLocation = null;
if (preg_match('/^location:\s*(.*?)$/mi', $initRes, $matches)) {
    $uploadLocation = trim($matches[1]);
}

if (!$uploadLocation) {
    die("<b style='color:red;'>Failed to extract upload location URL!</b>");
}
echo "Step 1 Upload Session URL acquired!<br>";

// Step 2: Stream Data to Location
$ch = curl_init($uploadLocation);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => 'PUT',
    CURLOPT_POSTFIELDS => $dummyPdf,
    CURLOPT_HTTPHEADER => [
        "Content-Length: {$fileSize}",
        "Content-Type: application/pdf"
    ],
    CURLOPT_TIMEOUT => 60
]);
$uploadRes = curl_exec($ch);
$uploadHttp = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "Step 2 (Data Transfer) HTTP: <b style='color:" . ($uploadHttp == 200 || $uploadHttp == 201 ? "green" : "red") . "'>{$uploadHttp}</b><br>";
echo "<h3>Response Data:</h3>";
echo "<pre style='background:#f1f5f9;padding:12px;border-radius:6px;font-size:14px;'>" . htmlspecialchars($uploadRes) . "</pre>";

$uploaded = json_decode($uploadRes, true);
if (!empty($uploaded['webViewLink'])) {
    echo "<p><a href='{$uploaded['webViewLink']}' target='_blank' style='display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;'>🚀 คลิกที่นี่เพื่อเปิดดูไฟล์ที่อัปโหลดสำเร็จใน Google Drive!</a></p>";
}
?>
