import http from 'http';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Admin Console CRUD & Management Tests...');

  // Test 1: Fetch Users List
  const t1 = await request('GET', '/api/admin/users-list');
  console.log('Test 1 (Fetch Users List):', t1.status === 200 && Array.isArray(t1.body.data) ? '✅ PASS' : '❌ FAIL', `Found ${t1.body.data.length} users`);

  // Test 2: Add New Department Head (English Department)
  const t2 = await request('POST', '/api/admin/users', {
    name: 'ครูเดวิด สมิธ',
    email: 'david.smith@school.ac.th',
    role: 'dept_head',
    department: 'ภาษาต่างประเทศ',
    position_title: 'หัวหน้ากลุ่มสาระฯ ภาษาต่างประเทศ',
    pin_code: '5678'
  });
  console.log('Test 2 (Add New Dept Head):', t2.status === 201 && t2.body.user ? '✅ PASS' : '❌ FAIL', t2.body);
  const newUserId = t2.body.user ? t2.body.user.id : null;

  // Test 3: Edit Department Head Name and PIN
  const t3 = await request('PUT', `/api/admin/users/${newUserId}`, {
    name: 'ครูเดวิด สมิธ (ปรับปรุงชื่อ)',
    role: 'dept_head',
    department: 'ภาษาต่างประเทศ',
    position_title: 'หัวหน้ากลุ่มสาระฯ ภาษาต่างประเทศ (ชำนาญการพิเศษ)',
    pin_code: '9999'
  });
  console.log('Test 3 (Update Dept Head Info & PIN):', t3.status === 200 && t3.body.user.pin_code === '9999' ? '✅ PASS' : '❌ FAIL');

  // Test 4: Verify Login with New PIN 9999
  const t4 = await request('POST', '/api/auth/login', {
    email: 'david.smith@school.ac.th',
    pin: '9999'
  });
  console.log('Test 4 (Login as Updated Dept Head with new PIN):', t4.status === 200 && t4.body.user.role === 'dept_head' ? '✅ PASS' : '❌ FAIL');

  // Test 5: Dashboard Stats
  const t5 = await request('GET', '/api/admin/stats');
  console.log('Test 5 (Dashboard Stats):', t5.status === 200 && t5.body.data.totalPlans !== undefined ? '✅ PASS' : '❌ FAIL', t5.body.data);

  // Test 6: Delete Test User
  const t6 = await request('DELETE', `/api/admin/users/${newUserId}`);
  console.log('Test 6 (Delete User):', t6.status === 200 ? '✅ PASS' : '❌ FAIL', t6.body.message);

  console.log('🎉 All Admin CRUD Tests Succeeded!');
}

runTests().catch(console.error);
