import path from 'path';
import fs from 'fs';
import assert from 'assert';

const BASE_URL = 'http://127.0.0.1:3000';

async function run5TierApprovalTests() {
  console.log('🧪 Starting Comprehensive 5-Tier Approval Timeline Tests...');

  // 1. Verify all 5 reviewer accounts exist and can authenticate with PIN 1234
  const reviewers = [
    { role: 'dept_head', email: 'head.science@school.ac.th', title: 'หัวหน้ากลุ่มสาระฯ' },
    { role: 'curriculum_head', email: 'curriculum@school.ac.th', title: 'หัวหน้างานหลักสูตร' },
    { role: 'academic_head', email: 'academic.head@school.ac.th', title: 'หัวหน้ากลุ่มบริหารวิชาการ' },
    { role: 'academic_director', email: 'academic@school.ac.th', title: 'รองผู้อำนวยการฝ่ายวิชาการ' },
    { role: 'director', email: 'director@school.ac.th', title: 'ผู้อำนวยการโรงเรียน' }
  ];

  console.log('\n--- Test 1: Authenticating All 5 Reviewer Tiers ---');
  for (const r of reviewers) {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: r.email, pin: '1234' })
    });
    const loginJson = await loginRes.json();
    assert(loginJson.success, `Login failed for ${r.email}: ${loginJson.message}`);
    assert.strictEqual(loginJson.user.role, r.role, `Expected role ${r.role}, got ${loginJson.user.role}`);
    console.log(`✅ Level [${r.role}]: Authenticated ${loginJson.user.name} (${loginJson.user.position_title})`);
  }

  // 2. Submit a new lesson plan
  console.log('\n--- Test 2: Teacher Submits New Lesson Plan ---');
  const termsRes = await fetch(`${BASE_URL}/api/terms`);
  const termsJson = await termsRes.json();
  const term = termsJson.data[0];

  const teacherEmail = `teacher.5tier.${Date.now()}@school.ac.th`;
  const form = new FormData();
  form.append('teacher_name', 'ครูทดสอบ ห้าระดับ');
  form.append('teacher_email', teacherEmail);
  form.append('teacher_department', 'วิทยาศาสตร์และเทคโนโลยี');
  form.append('grade_level', 'มัธยมศึกษาปีที่ 5');
  form.append('subject_code', 'ว32101');
  form.append('subject_name', 'ฟิสิกส์ประยุกต์');
  form.append('academic_term_id', term.id);
  form.append('signature_data', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAALElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvBh1gAAH6cE4kAAAAAElFTkSuQmCC');

  const samplePdfPath = path.resolve('test/sample_plan.pdf');
  form.append('pdf_file', new Blob([fs.readFileSync(samplePdfPath)], { type: 'application/pdf' }), 'plan.pdf');

  const submitRes = await fetch(`${BASE_URL}/api/plans/submit`, { method: 'POST', body: form });
  const submitJson = await submitRes.json();
  assert(submitJson.success, `Submission failed: ${submitJson.message}`);
  const planId = submitJson.planId;
  console.log(`✅ Lesson Plan submitted successfully (ID: ${planId})`);

  // 3. Verify Initial 5-Tier Timeline
  console.log('\n--- Test 3: Verify Initial 5-Tier Timeline ---');
  const t1Res = await fetch(`${BASE_URL}/api/plans/${planId}/timeline`);
  const t1Json = await t1Res.json();
  assert.strictEqual(t1Json.data.timeline.length, 5, `Expected exactly 5 timeline steps, got ${t1Json.data.timeline.length}`);
  assert.strictEqual(t1Json.data.current_stage, 'dept_head', 'Initial stage must be dept_head');
  console.log('Current Reviewer:', t1Json.data.current_reviewer_title);
  t1Json.data.timeline.forEach(step => {
    console.log(`  Tier ${step.step_order}: ${step.stage_title} [${step.stage_key}] -> Status: ${step.status}`);
  });

  // Verify step statuses
  assert.strictEqual(t1Json.data.timeline[0].status, 'in_progress', 'Tier 1 must be in_progress');
  assert.strictEqual(t1Json.data.timeline[1].status, 'waiting', 'Tier 2 must be waiting');
  assert.strictEqual(t1Json.data.timeline[2].status, 'waiting', 'Tier 3 must be waiting');
  assert.strictEqual(t1Json.data.timeline[3].status, 'waiting', 'Tier 4 must be waiting');
  assert.strictEqual(t1Json.data.timeline[4].status, 'waiting', 'Tier 5 must be waiting');
  console.log('✅ Initial timeline has exactly 5 steps in correct states');

  // 4. Step 1: Dept Head Approves -> Advances to curriculum_head
  console.log('\n--- Test 4: Tier 1 (หน.กลุ่มสาระฯ) Approves ---');
  const rev1 = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'เห็นชอบตามเสนอ จัดทำเนื้อหาถูกต้องครบถ้วน',
      reviewer_name: 'ครูมาลี ประเสริฐยิ่ง',
      reviewer_role: 'หัวหน้ากลุ่มสาระฯ วิทยาศาสตร์และเทคโนโลยี'
    })
  });
  const rev1Json = await rev1.json();
  assert(rev1Json.success, 'Step 1 approval failed');
  assert.strictEqual(rev1Json.nextStage, 'curriculum_head', 'Must advance to curriculum_head');
  console.log(`✅ Tier 1 approved: ${rev1Json.message} -> nextStage: ${rev1Json.nextStage}`);

  // Verify my_turn filter for curriculum_head
  const currTurnRes = await fetch(`${BASE_URL}/api/admin/plans?reviewer_role=curriculum_head&filter_mode=my_turn`);
  const currTurnJson = await currTurnRes.json();
  assert(currTurnJson.data.some(p => p.id === planId), 'Plan must appear in curriculum_head my_turn queue');
  console.log(`✅ Plan correctly appeared in curriculum_head queue (Found ${currTurnJson.data.length} plans)`);

  // 5. Step 2: Curriculum Head Approves -> Advances to academic_head
  console.log('\n--- Test 5: Tier 2 (หน.งานหลักสูตร) Approves ---');
  const rev2 = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'สอดคล้องกับหลักสูตรสถานศึกษา พ.ศ. 2561 (ปรับปรุง 2568)',
      reviewer_name: 'ครูอรทัย งานหลักสูตร',
      reviewer_role: 'หัวหน้างานหลักสูตร'
    })
  });
  const rev2Json = await rev2.json();
  assert(rev2Json.success, 'Step 2 approval failed');
  assert.strictEqual(rev2Json.nextStage, 'academic_head', 'Must advance to academic_head');
  console.log(`✅ Tier 2 approved: ${rev2Json.message} -> nextStage: ${rev2Json.nextStage}`);

  // Verify my_turn filter for academic_head
  const acadHeadRes = await fetch(`${BASE_URL}/api/admin/plans?reviewer_role=academic_head&filter_mode=my_turn`);
  const acadHeadJson = await acadHeadRes.json();
  assert(acadHeadJson.data.some(p => p.id === planId), 'Plan must appear in academic_head my_turn queue');
  console.log(`✅ Plan correctly appeared in academic_head queue (Found ${acadHeadJson.data.length} plans)`);

  // 6. Step 3: Academic Head Approves -> Advances to academic_director
  console.log('\n--- Test 6: Tier 3 (หน.กลุ่มบริหารวิชาการ) Approves ---');
  const rev3 = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'ผ่านเกณฑ์มาตรฐานกลุ่มบริหารวิชาการครบถ้วน',
      reviewer_name: 'ครูปรีชา บริหารวิชาการ',
      reviewer_role: 'หัวหน้ากลุ่มบริหารวิชาการ'
    })
  });
  const rev3Json = await rev3.json();
  assert(rev3Json.success, 'Step 3 approval failed');
  assert.strictEqual(rev3Json.nextStage, 'academic_director', 'Must advance to academic_director');
  console.log(`✅ Tier 3 approved: ${rev3Json.message} -> nextStage: ${rev3Json.nextStage}`);

  // 7. Step 4: Academic Director Approves -> Advances to director
  console.log('\n--- Test 7: Tier 4 (รอง ผอ. ฝ่ายวิชาการ) Approves ---');
  const rev4 = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'ผ่านการกลั่นกรองวิชาการ เห็นควรเสนอผู้อำนวยการโรงเรียนพิจารณาอนุมัติ',
      reviewer_name: 'ดร.ประสิทธิ์ ปัญญายิ่ง',
      reviewer_role: 'รองผู้อำนวยการฝ่ายวิชาการ'
    })
  });
  const rev4Json = await rev4.json();
  assert(rev4Json.success, 'Step 4 approval failed');
  assert.strictEqual(rev4Json.nextStage, 'director', 'Must advance to director');
  console.log(`✅ Tier 4 approved: ${rev4Json.message} -> nextStage: ${rev4Json.nextStage}`);

  // 8. Step 5: School Director Final Approval -> Completed
  console.log('\n--- Test 8: Tier 5 (ผู้อำนวยการโรงเรียน) Final Approval ---');
  const rev5 = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'อนุมัติให้ใช้จัดการเรียนการสอนได้ประจำภาคเรียนที่ 1/2569',
      reviewer_name: 'ดร.สมศักดิ์ นำพาพัฒนา',
      reviewer_role: 'ผู้อำนวยการโรงเรียน'
    })
  });
  const rev5Json = await rev5.json();
  assert(rev5Json.success, 'Step 5 approval failed');
  assert.strictEqual(rev5Json.nextStage, 'completed', 'Must be completed');
  console.log(`✅ Tier 5 approved: ${rev5Json.message} -> nextStage: ${rev5Json.nextStage}`);

  // Check Final Timeline & Plan Status
  const tFinalRes = await fetch(`${BASE_URL}/api/plans/${planId}/timeline`);
  const tFinalJson = await tFinalRes.json();
  assert.strictEqual(tFinalJson.data.plan.submission_status, 'approved', 'Plan submission_status must be approved');
  assert.strictEqual(tFinalJson.data.plan.current_stage, 'completed', 'Plan current_stage must be completed');
  
  const allCompleted = tFinalJson.data.timeline.every(s => s.status === 'completed');
  assert(allCompleted, 'All 5 timeline steps must be completed');
  console.log('\n🎉 Final Timeline Status: 100% Complete for all 5 Tiers:');
  tFinalJson.data.timeline.forEach(s => {
    console.log(`  Tier ${s.step_order}: ${s.stage_title} -> [${s.status}] By: ${s.reviewer_name}`);
  });

  // 9. Test Revision Workflow from Tier 2
  console.log('\n--- Test 9: Test Revision Action from Intermediate Tier ---');
  const form2 = new FormData();
  form2.append('teacher_name', 'ครูสมปอง ทดสอบแก้ไข');
  form2.append('teacher_email', `teacher.revision.${Date.now()}@school.ac.th`);
  form2.append('teacher_department', 'คณิตศาสตร์');
  form2.append('grade_level', 'มัธยมศึกษาปีที่ 1');
  form2.append('subject_code', 'ค21101');
  form2.append('subject_name', 'คณิตศาสตร์พื้นฐาน');
  form2.append('academic_term_id', term.id);
  form2.append('signature_data', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAALElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvBh1gAAH6cE4kAAAAAElFTkSuQmCC');
  form2.append('pdf_file', new Blob([fs.readFileSync(samplePdfPath)], { type: 'application/pdf' }), 'plan2.pdf');

  const sub2Res = await fetch(`${BASE_URL}/api/plans/submit`, { method: 'POST', body: form2 });
  const sub2Json = await sub2Res.json();
  const plan2Id = sub2Json.planId;

  // Advance to Tier 2 first
  await fetch(`${BASE_URL}/api/admin/plans/${plan2Id}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'approve', reviewer_name: 'ครูสุพจน์ เลขาวิทย์', reviewer_role: 'หัวหน้ากลุ่มสาระฯ คณิตศาสตร์' })
  });

  // Curriculum head sends back for revision
  const revBackRes = await fetch(`${BASE_URL}/api/admin/plans/${plan2Id}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'revision',
      feedback: 'กรุณาปรับปรุงตารางการวัดผลประเมินผลให้สอดคล้องกับตัวชี้วัด',
      reviewer_name: 'ครูอรทัย งานหลักสูตร',
      reviewer_role: 'หัวหน้างานหลักสูตร'
    })
  });
  const revBackJson = await revBackRes.json();
  assert(revBackJson.success, 'Revision action failed');
  console.log(`✅ Plan successfully sent back for revision: ${revBackJson.message}`);

  const tRevRes = await fetch(`${BASE_URL}/api/plans/${plan2Id}/timeline`);
  const tRevJson = await tRevRes.json();
  assert.strictEqual(tRevJson.data.plan.submission_status, 'revision_needed', 'Status must be revision_needed');
  console.log(`✅ Revision state verified: status=${tRevJson.data.plan.submission_status}, stage=${tRevJson.data.plan.current_stage}`);

  console.log('\n======================================================');
  console.log('🏆 ALL 5-TIER APPROVAL WORKFLOW TESTS PASSED 100%! 🏆');
  console.log('======================================================\n');
}

run5TierApprovalTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
