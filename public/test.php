<?php
header('Content-Type: text/html; charset=utf-8');
echo "<h2>Server Diagnostics</h2>";
echo "<b>PHP Version:</b> " . phpversion() . "<br>";
echo "<b>Disabled Functions:</b> " . ini_get('disable_functions') . "<br>";
echo "<b>OS:</b> " . PHP_OS . "<br>";
echo "<b>Server Software:</b> " . $_SERVER['SERVER_SOFTWARE'] . "<br>";

$nodePaths = [
    '/usr/bin/node',
    '/usr/local/bin/node',
    '/bin/node',
    '/root/.nvm/versions/node/',
    '/home/saluangac/.nvm/'
];

echo "<h3>Checking Node.js:</h3>";
foreach ($nodePaths as $p) {
    echo "$p: " . (file_exists($p) ? "FOUND" : "not found") . "<br>";
}

// Check MySQL connection
echo "<h3>Checking MySQL Connection:</h3>";
try {
    $pdo = new PDO("mysql:host=localhost;dbname=saluangac_plan;charset=utf8mb4", "saluangac_plan", "wun426655");
    echo "<b style='color:green;'>SUCCESS: Connected to MySQL database saluangac_plan!</b><br>";
    $stmt = $pdo->query("SHOW TABLES");
    $tables = $stmt->fetchAll(PDO::FETCH_COLUMN);
    echo "Tables in DB: " . implode(", ", $tables) . "<br>";
    $uStmt = $pdo->query("SELECT name, email, role FROM users LIMIT 5");
    $users = $uStmt->fetchAll(PDO::FETCH_ASSOC);
    echo "Users in DB: " . json_encode($users, JSON_UNESCAPED_UNICODE) . "<br>";
} catch (Exception $e) {
    echo "<b style='color:red;'>FAILED to connect to MySQL: " . $e->getMessage() . "</b><br>";
}
?>
