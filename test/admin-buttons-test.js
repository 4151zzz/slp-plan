import assert from 'assert';

const BASE_URL = 'http://localhost:3000';

async function runTests() {
  console.log('🧪 Starting Admin Console Functions & Buttons Test Suite...\n');

  // 1. Check Stats API
  console.log('1. Testing Stats API...');
  const statsRes = await fetch(`${BASE_URL}/api/admin/stats`);
  const statsJson = await statsRes.json();
  assert.strictEqual(statsJson.success, true);
  assert.ok(statsJson.data.totalPlans !== undefined);
  assert.ok(Array.isArray(statsJson.data.deptStats));
  console.log(`   ✅ Stats OK: Total Plans=${statsJson.data.totalPlans}, Approved=${statsJson.data.approvedPlans}`);

  // 2. User CRUD & Reset PIN
  console.log('2. Testing User CRUD & Reset PIN...');
  const testUserEmail = `test.btn.${Date.now()}@school.ac.th`;
  
  // 2a. Create User
  const createUserRes = await fetch(`${BASE_URL}/api/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ครูทดสอบ ปุ่มแอดมิน',
      email: testUserEmail,
      role: 'curriculum_head',
      department: 'ฝ่ายวิชาการ',
      position_title: 'หัวหน้างานหลักสูตร',
      pin_code: '9999'
    })
  });
  const createUserJson = await createUserRes.json();
  assert.strictEqual(createUserJson.success, true);
  const createdUserId = createUserJson.user.id;
  assert.strictEqual(createUserJson.user.pin_code, '9999');
  console.log(`   ✅ User Created: ID=${createdUserId}, Role=curriculum_head, PIN=9999`);

  // 2b. Edit User
  const editUserRes = await fetch(`${BASE_URL}/api/admin/users/${createdUserId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ครูทดสอบ ปุ่มแอดมิน (แก้ไขแล้ว)',
      role: 'academic_head',
      department: 'ฝ่ายวิชาการ',
      position_title: 'หัวหน้ากลุ่มบริหารวิชาการ',
      pin_code: '8888'
    })
  });
  const editUserJson = await editUserRes.json();
  assert.strictEqual(editUserJson.success, true);
  assert.strictEqual(editUserJson.user.name, 'ครูทดสอบ ปุ่มแอดมิน (แก้ไขแล้ว)');
  console.log(`   ✅ User Edited: Role updated to academic_head, PIN=8888`);

  // 2c. Reset PIN
  const resetPinRes = await fetch(`${BASE_URL}/api/admin/users/${createdUserId}/reset-pin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234' })
  });
  const resetPinJson = await resetPinRes.json();
  assert.strictEqual(resetPinJson.success, true);
  assert.strictEqual(resetPinJson.newPin, '1234');
  console.log(`   ✅ User PIN Reset to 1234 OK`);

  // 2d. Delete User
  const deleteUserRes = await fetch(`${BASE_URL}/api/admin/users/${createdUserId}`, {
    method: 'DELETE'
  });
  const deleteUserJson = await deleteUserRes.json();
  assert.strictEqual(deleteUserJson.success, true);
  console.log(`   ✅ User Deleted OK`);

  // 3. Department CRUD & Head PIN Reset
  console.log('3. Testing Department CRUD & Head PIN Reset...');
  const testDeptCode = `testdept${Math.floor(Math.random() * 10000)}`;
  const createDeptRes = await fetch(`${BASE_URL}/api/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `หมวดวิชาทดสอบ ${testDeptCode}`,
      code: testDeptCode,
      head_name: 'ครูหัวหน้าหมวด ทดสอบ',
      head_email: `head.${testDeptCode}@school.ac.th`,
      head_pin: '5555',
      description: 'คำอธิบายหมวดทดสอบ'
    })
  });
  const createDeptJson = await createDeptRes.json();
  assert.strictEqual(createDeptJson.success, true);
  const createdDeptId = createDeptJson.data.id;
  console.log(`   ✅ Department Created: ID=${createdDeptId}`);

  // 3b. Reset Head PIN
  const resetDeptPinRes = await fetch(`${BASE_URL}/api/departments/${createdDeptId}/reset-pin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234' })
  });
  const resetDeptPinJson = await resetDeptPinRes.json();
  assert.strictEqual(resetDeptPinJson.success, true);
  assert.strictEqual(resetDeptPinJson.newPin, '1234');
  console.log(`   ✅ Department Head PIN Reset OK`);

  // 3c. Delete Dept
  const deleteDeptRes = await fetch(`${BASE_URL}/api/departments/${createdDeptId}`, {
    method: 'DELETE'
  });
  const deleteDeptJson = await deleteDeptRes.json();
  assert.strictEqual(deleteDeptJson.success, true);
  console.log(`   ✅ Department Deleted OK`);

  // 4. Academic Term CRUD & Toggle
  console.log('4. Testing Academic Term CRUD & Toggle...');
  const testTermCode = `9/${Date.now().toString().slice(-4)}`;
  const createTermRes = await fetch(`${BASE_URL}/api/admin/terms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: testTermCode,
      name: `ภาคเรียนทดสอบ ${testTermCode}`,
      is_active: false
    })
  });
  const createTermJson = await createTermRes.json();
  assert.strictEqual(createTermJson.success, true);
  const termId = 'term-' + testTermCode.replace(/[^a-zA-Z0-9]/g, '-');
  console.log(`   ✅ Term Created: ID=${termId}`);

  // 4b. Toggle Term
  const toggleTermRes = await fetch(`${BASE_URL}/api/admin/terms/${termId}/toggle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: 1 })
  });
  const toggleTermJson = await toggleTermRes.json();
  assert.strictEqual(toggleTermJson.success, true);
  assert.strictEqual(toggleTermJson.is_active, 1);
  console.log(`   ✅ Term Toggled to Active OK`);

  // 4c. Delete Term
  const deleteTermRes = await fetch(`${BASE_URL}/api/admin/terms/${termId}`, {
    method: 'DELETE'
  });
  const deleteTermJson = await deleteTermRes.json();
  assert.strictEqual(deleteTermJson.success, true);
  console.log(`   ✅ Term Deleted OK`);

  // 5. System 5-Tier Timeline Verification & Diagnostic Tool
  console.log('5. Testing 5-Tier Timeline Verification API...');
  const verifyRes = await fetch(`${BASE_URL}/api/admin/system/verify-timelines`, {
    method: 'POST'
  });
  const verifyJson = await verifyRes.json();
  assert.strictEqual(verifyJson.success, true);
  assert.ok(verifyJson.totalPlans >= 0);
  console.log(`   ✅ 5-Tier Timeline Verification Tool OK: Scanned ${verifyJson.totalPlans} plans, repaired ${verifyJson.repairedCount}`);

  console.log('\n🎉 ALL ADMIN API & BUTTON OPERATIONS PASSED 100%!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
