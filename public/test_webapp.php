<?php
header('Content-Type: text/html; charset=utf-8');
echo "<h2>Google Apps Script Web App Test</h2>";

$webAppUrl = 'https://script.google.com/macros/s/AKfycbwj0MbEaIonkYhTbiI0HbVV1SgzDU4GqtrVwyBI0Eld5MgcoORD1040myQX13djqwLH/exec';

$dummyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF";

$postData = [
    'fileName' => 'Test_WebApp_Plan_' . date('Y-m-d_His') . '.pdf',
    'fileBase64' => base64_encode($dummyPdf),
    'department' => 'กลุ่มสาระการเรียนรู้วิทยาศาสตร์และเทคโนโลยี',
    'teacherName' => 'ครูปิยะพงษ์ ทดสอบระบบ'
];

echo "Connecting to Web App URL: <b>{$webAppUrl}</b><br>";

$ch = curl_init($webAppUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true, // Google Apps Script redirects with 302
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode($postData),
    CURLOPT_TIMEOUT => 40,
    CURLOPT_SSL_VERIFYPEER => true
]);
$res = curl_exec($ch);
$http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
curl_close($ch);

echo "HTTP Status: <b>{$http}</b><br>";
if ($curlErr) echo "Curl Error: {$curlErr}<br>";
echo "<h3>Response Data from Google:</h3>";
echo "<pre style='background:#f1f5f9;padding:12px;border-radius:6px;font-size:14px;'>" . htmlspecialchars($res) . "</pre>";

$json = json_decode($res, true);
if (!empty($json['success'])) {
    echo "<p style='color:green;font-size:1.1rem;font-weight:bold;'>🎉 สำเร็จ 100%! ไฟล์ถูกอัปโหลดขึ้น Google Drive ของคุณเรียบร้อยแล้ว!</p>";
    if (!empty($json['webViewLink'])) {
        echo "<p><a href='{$json['webViewLink']}' target='_blank' style='display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;'>🚀 คลิกที่นี่เพื่อเปิดดูไฟล์ใน Google Drive</a></p>";
    }
}
?>
