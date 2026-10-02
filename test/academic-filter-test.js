import assert from 'assert';

const BASE_URL = 'http://localhost:3000';

async function testAcademicFilter() {
  console.log('🧪 Starting Academic Director Stage & Department Filter Tests...\n');

  // 1. Check Academic Director login with PIN
  console.log('Test 1: Login as Academic Director (ดร.ประสิทธิ์ ปัญญายิ่ง)...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'academic@school.ac.th',
      pin: '1234'
    })
  });
  const loginJson = await loginRes.json();
  assert.strictEqual(loginRes.status, 200);
  assert.strictEqual(loginJson.success, true);
  assert.strictEqual(loginJson.user.role, 'academic_director');
  console.log('✅ Test 1 Passed: Academic Director successfully authenticated.');

  // 2. Query "my_turn" for Academic Director
  console.log('\nTest 2: Query plans where filter_mode=my_turn for Academic Director...');
  const myTurnRes = await fetch(`${BASE_URL}/api/admin/plans?reviewer_role=academic_director&filter_mode=my_turn`);
  const myTurnJson = await myTurnRes.json();
  assert.strictEqual(myTurnJson.success, true);
  assert(Array.isArray(myTurnJson.data));

  // Verify that EVERY plan returned is strictly at academic_director stage
  const allMyTurn = myTurnJson.data.every(p => 
    p.current_stage === 'academic_director' && 
    ['submitted', 'under_review'].includes(p.submission_status)
  );
  assert(allMyTurn, 'All plans in my_turn must have current_stage = academic_director');
  console.log(`✅ Test 2 Passed: Exactly ${myTurnJson.data.length} plans returned, 100% at academic_director stage.`);
  console.log('   KPI counts in response:', myTurnJson.counts);

  // 3. Query "waiting_others" for Academic Director
  console.log('\nTest 3: Query plans where filter_mode=waiting_others for Academic Director...');
  const waitingRes = await fetch(`${BASE_URL}/api/admin/plans?reviewer_role=academic_director&filter_mode=waiting_others`);
  const waitingJson = await waitingRes.json();
  assert.strictEqual(waitingJson.success, true);
  const noneAtAcademic = waitingJson.data.every(p => p.current_stage !== 'academic_director');
  assert(noneAtAcademic, 'No plans in waiting_others should be at academic_director stage');
  console.log(`✅ Test 3 Passed: Found ${waitingJson.data.length} plans in other stages, none mixed into academic queue.`);

  // 4. Query "approved" with Department filter ("เลือกดูแต่ละหมวดเอา")
  console.log('\nTest 4: Query filter_mode=approved with department filter (วิทยาศาสตร์และเทคโนโลยี)...');
  const appDeptRes = await fetch(`${BASE_URL}/api/admin/plans?reviewer_role=academic_director&filter_mode=approved&department=${encodeURIComponent('วิทยาศาสตร์และเทคโนโลยี')}`);
  const appDeptJson = await appDeptRes.json();
  assert.strictEqual(appDeptJson.success, true);
  const allApprovedAndScience = appDeptJson.data.every(p => 
    p.submission_status === 'approved' && 
    p.teacher_department === 'วิทยาศาสตร์และเทคโนโลยี'
  );
  assert(allApprovedAndScience, 'All plans must be approved and belong to Science department');
  console.log(`✅ Test 4 Passed: Department filter on approved plans working perfectly (Found ${appDeptJson.data.length} plans).`);

  // 5. Query "my_turn" for Dept Head
  console.log('\nTest 5: Verify Dept Head scoping on my_turn...');
  const deptHeadRes = await fetch(`${BASE_URL}/api/admin/plans?reviewer_role=dept_head&reviewer_dept=${encodeURIComponent('วิทยาศาสตร์และเทคโนโลยี')}&filter_mode=my_turn`);
  const deptHeadJson = await deptHeadRes.json();
  assert.strictEqual(deptHeadJson.success, true);
  const allDeptHeadMyTurn = deptHeadJson.data.every(p => 
    p.current_stage === 'dept_head' && 
    p.teacher_department === 'วิทยาศาสตร์และเทคโนโลยี'
  );
  assert(allDeptHeadMyTurn, 'All plans must be at dept_head stage for science department');
  console.log(`✅ Test 5 Passed: Dept Head my_turn correctly returns only plans at dept_head for their department.`);

  console.log('\n🎉 ALL ACADEMIC FILTER & DEPARTMENT SCOPING TESTS PASSED 100%! 🎉\n');
}

testAcademicFilter().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
