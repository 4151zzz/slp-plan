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

$jsonPayload = json_encode($postData, JSON_UNESCAPED_UNICODE);

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
curl_setopt($ch, CURLOPT_TIMEOUT, 60);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

$rawRes = curl_exec($ch);
$http = intval(curl_getinfo($ch, CURLINFO_HTTP_CODE));
$headerSize = intval(curl_getinfo($ch, CURLINFO_HEADER_SIZE));
$redirectUrl = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
$curlErr = curl_error($ch);
curl_close($ch);

$resHeaders = $rawRes !== false ? substr($rawRes, 0, $headerSize) : '';
$res = $rawRes !== false ? substr($rawRes, $headerSize) : '';

$hops = 0;
while (in_array($http, [301, 302, 303, 307, 308]) && $hops < 5) {
    $hops++;
    if (empty($redirectUrl) && preg_match('/^Location:\s*(.+)$/mi', $resHeaders, $m)) {
        $redirectUrl = trim($m[1]);
    }
    if (empty($redirectUrl)) break;

    $ch2 = curl_init($redirectUrl);
    curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch2, CURLOPT_HEADER, true);
    curl_setopt($ch2, CURLOPT_HTTPGET, true);
    curl_setopt($ch2, CURLOPT_TIMEOUT, 60);
    curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch2, CURLOPT_SSL_VERIFYHOST, 0);

    $rawRes2 = curl_exec($ch2);
    $http = intval(curl_getinfo($ch2, CURLINFO_HTTP_CODE));
    $headerSize2 = intval(curl_getinfo($ch2, CURLINFO_HEADER_SIZE));
    $redirectUrl = curl_getinfo($ch2, CURLINFO_REDIRECT_URL);
    $curlErr = curl_error($ch2);
    curl_close($ch2);

    if ($rawRes2 === false) break;
    $resHeaders = substr($rawRes2, 0, $headerSize2);
    $res = substr($rawRes2, $headerSize2);
}

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
