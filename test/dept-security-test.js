import assert from 'assert';

async function runTests() {
  console.log('--- Starting Systematic Department & Security Verification Tests ---');

  // 1. Check all 8 standard Thai departments
  console.log('Test 1: Verify all 8 core departments exist...');
  const deptsRes = await fetch('http://localhost:3000/api/departments');
  const deptsJson = await deptsRes.json();
  assert.strictEqual(deptsJson.success, true);
  assert(deptsJson.data.length >= 8, 'Must have at least 8 standard departments');
  
  const expectedCodes = ['sci', 'math', 'thai', 'foreign', 'social', 'health', 'art', 'career'];
  for (const code of expectedCodes) {
    const found = deptsJson.data.find(d => d.code === code);
    assert(found, `Expected department ${code} to exist`);
    assert(found.head_name, `Department ${code} must have a head assigned`);
    assert(found.head_email, `Department ${code} must have head email assigned`);
  }
  console.log('✅ Test 1 Passed: All 8 core Thai learning groups exist with designated heads!');

  // 2. Test adding custom department
  console.log('Test 2: Admin adding custom department (กิจกรรมพัฒนาผู้เรียน)...');
  const addRes = await fetch('http://localhost:3000/api/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'กิจกรรมพัฒนาผู้เรียน',
      code: 'guidance',
      head_name: 'ครูพิมล ปัญญาสว่าง',
      head_email: 'head.guidance@school.ac.th',
      head_pin: '4321',
      description: 'แนะแนว กิจกรรมชุมนุม และลูกเสือ-เนตรนารี'
    })
  });
  const addJson = await addRes.json();
  assert.strictEqual(addJson.success, true);
  console.log('✅ Test 2 Passed: Successfully added custom department');

  // 3. Test updating department and changing head
  console.log('Test 3: Updating department and head...');
  const updateRes = await fetch('http://localhost:3000/api/departments/dept-guidance', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'กิจกรรมพัฒนาผู้เรียนและแนะแนว',
      head_name: 'ครูพิมล ปัญญาสว่าง (หัวหน้าหมวด)',
      head_pin: '9999'
    })
  });
  const updateJson = await updateRes.json();
  assert.strictEqual(updateJson.success, true);
  assert.strictEqual(updateJson.data.head_pin, '9999');
  console.log('✅ Test 3 Passed: Department and head details updated successfully');

  // 4. Test Security: Reviewer login requiring PIN
  console.log('Test 4: Verify PIN enforcement on reviewer accounts...');
  // 4a: Login with wrong PIN
  const wrongPinRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'head.guidance@school.ac.th',
      pin: '0000'
    })
  });
  assert.strictEqual(wrongPinRes.status, 401, 'Should reject invalid PIN with 401');
  console.log('  -> Rejected invalid PIN with 401 as expected');

  // 4b: Login with correct PIN
  const correctPinRes = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'head.guidance@school.ac.th',
      pin: '9999'
    })
  });
  const correctPinJson = await correctPinRes.json();
  assert.strictEqual(correctPinJson.success, true, 'Should accept valid PIN');
  assert.strictEqual(correctPinJson.user.role, 'dept_head');
  console.log('  -> Accepted valid PIN with full authenticated session');
  console.log('✅ Test 4 Passed: PIN security validation strictly enforced');

  // 5. Test Deleting custom department
  console.log('Test 5: Deleting custom department...');
  const delRes = await fetch('http://localhost:3000/api/departments/dept-guidance', {
    method: 'DELETE'
  });
  const delJson = await delRes.json();
  assert.strictEqual(delJson.success, true);
  console.log('✅ Test 5 Passed: Custom department deleted successfully');

  console.log('\n🎉 ALL SECURITY & SYSTEMATIC DEPARTMENT TESTS PASSED! 🎉\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
