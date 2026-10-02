import assert from 'assert';

const BASE_URL = 'http://localhost:3000';

async function testTermToggle() {
  console.log('🧪 Starting Academic Term Open/Close Toggle Tests...\n');

  // 1. Get all terms
  const termsRes = await fetch(`${BASE_URL}/api/terms`);
  const termsJson = await termsRes.json();
  assert.strictEqual(termsJson.success, true);
  assert(termsJson.data.length > 0, 'Must have at least one term');
  const term = termsJson.data[0];
  console.log(`Test 1: Found ${termsJson.data.length} terms. Target term: ${term.name} (Code: ${term.code}, Current is_active: ${term.is_active})`);

  // 2. Test Deactivating / Closing Term
  console.log('\nTest 2: Deactivating / Closing target term (active: 0)...');
  const closeRes = await fetch(`${BASE_URL}/api/admin/terms/${term.id}/toggle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: 0 })
  });
  const closeJson = await closeRes.json();
  assert.strictEqual(closeRes.status, 200);
  assert.strictEqual(closeJson.success, true);
  assert.strictEqual(closeJson.is_active, 0);
  console.log('✅ Test 2 Passed: Term successfully closed (is_active: 0)');

  // Verify DB state
  const verifyCloseRes = await fetch(`${BASE_URL}/api/terms`);
  const verifyCloseJson = await verifyCloseRes.json();
  const closedTerm = verifyCloseJson.data.find(t => t.id === term.id);
  assert.strictEqual(closedTerm.is_active, 0);

  // 3. Test Activating / Opening Term
  console.log('\nTest 3: Activating / Opening target term (active: 1)...');
  const openRes = await fetch(`${BASE_URL}/api/admin/terms/${term.id}/toggle`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: 1 })
  });
  const openJson = await openRes.json();
  assert.strictEqual(openRes.status, 200);
  assert.strictEqual(openJson.success, true);
  assert.strictEqual(openJson.is_active, 1);
  console.log('✅ Test 3 Passed: Term successfully opened (is_active: 1)');

  // Verify DB state
  const verifyOpenRes = await fetch(`${BASE_URL}/api/terms`);
  const verifyOpenJson = await verifyOpenRes.json();
  const openedTerm = verifyOpenJson.data.find(t => t.id === term.id);
  assert.strictEqual(openedTerm.is_active, 1);

  // 4. Test Adding a new term
  console.log('\nTest 4: Creating new term (ภาคเรียนที่ 2/2570)...');
  const addRes = await fetch(`${BASE_URL}/api/admin/terms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: '2/2570',
      name: 'ภาคเรียนที่ 2 ปีการศึกษา 2570',
      start_date: '2027-11-01',
      end_date: '2028-03-31',
      is_active: 0
    })
  });
  const addJson = await addRes.json();
  assert.strictEqual(addJson.success, true);
  console.log('✅ Test 4 Passed: Created new term');

  // 5. Test Editing term
  console.log('\nTest 5: Editing term name and dates...');
  const editRes = await fetch(`${BASE_URL}/api/admin/terms/term-2-2570`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ภาคเรียนที่ 2 ปีการศึกษา 2570 (ฉบับแก้ไข)',
      start_date: '2027-11-15',
      end_date: '2028-04-15'
    })
  });
  const editJson = await editRes.json();
  assert.strictEqual(editJson.success, true);
  console.log('✅ Test 5 Passed: Edited term details');

  // 6. Test Deleting new term
  console.log('\nTest 6: Deleting temporary term...');
  const delRes = await fetch(`${BASE_URL}/api/admin/terms/term-2-2570`, {
    method: 'DELETE'
  });
  const delJson = await delRes.json();
  assert.strictEqual(delJson.success, true);
  console.log('✅ Test 6 Passed: Deleted temporary term');

  console.log('\n🎉 ALL ACADEMIC TERM OPEN/CLOSE TOGGLE TESTS PASSED 100%! 🎉\n');
}

testTermToggle().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
