<?php
header('Content-Type: text/html; charset=utf-8');
echo "<h2>Check Folder Details</h2>";

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

$id = '1hZ3MNDvHOK2mfUxQPIauuN9smqvDXlXt';

$ch = curl_init("https://www.googleapis.com/drive/v3/files/{$id}?supportsAllDrives=true&fields=id,name,mimeType,driveId,shared,parents");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$accessToken}"],
    CURLOPT_TIMEOUT => 15
]);
$res = curl_exec($ch);
$http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "Folder Metadata (HTTP {$http}):<br>";
echo "<pre>" . htmlspecialchars($res) . "</pre>";

// List available Shared Drives
$ch = curl_init("https://www.googleapis.com/drive/v3/drives");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["Authorization: Bearer {$accessToken}"],
    CURLOPT_TIMEOUT => 15
]);
$drivesRes = curl_exec($ch);
$drivesHttp = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "<h3>Available Shared Drives for this Service Account (HTTP {$drivesHttp}):</h3>";
echo "<pre>" . htmlspecialchars($drivesRes) . "</pre>";
?>
