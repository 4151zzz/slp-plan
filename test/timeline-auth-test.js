import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const BASE_URL = 'http://127.0.0.1:3000';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testAuthAndTimeline() {
  console.log('Testing Authentication & Multi-Tier Timeline...');

  // 1. Check users
  const usersRes = await fetch(`${BASE_URL}/api/auth/users`);
  const usersJson = await usersRes.json();
  console.log(`Found ${usersJson.data.length} users:`, usersJson.data.map(u => `${u.name} (${u.role})`));

  // 2. Submit a plan for Teacher Somchai
  const termsRes = await fetch(`${BASE_URL}/api/terms`);
  const termsJson = await termsRes.json();
  const term = termsJson.data[0];

  const teacherEmail = `somchai.${Date.now()}@school.ac.th`;
  const form = new FormData();
  form.append('teacher_name', 'ครูสมชาย รักการสอน');
  form.append('teacher_email', teacherEmail);
  form.append('teacher_department', 'วิทยาศาสตร์และเทคโนโลยี');
  form.append('grade_level', 'มัธยมศึกษาปีที่ 4');
  form.append('subject_code', 'ว31199');
  form.append('subject_name', 'วิทยาการคำนวณขั้นสูง');
  form.append('academic_term_id', term.id);
  form.append('signature_data', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAALElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvBh1gAAH6cE4kAAAAAElFTkSuQmCC');
  
  const samplePdfPath = path.resolve('test/sample_plan.pdf');
  form.append('pdf_file', new Blob([fs.readFileSync(samplePdfPath)], { type: 'application/pdf' }), 'sample.pdf');

  const submitRes = await fetch(`${BASE_URL}/api/plans/submit`, { method: 'POST', body: form });
  const submitJson = await submitRes.json();
  console.log('Submission result:', submitJson);
  const planId = submitJson.planId;

  // 3. Check Initial Timeline
  console.log('\nFetching Initial Timeline for new plan:');
  const t1Res = await fetch(`${BASE_URL}/api/plans/${planId}/timeline`);
  const t1Json = await t1Res.json();
  console.log('Current Reviewer Stage:', t1Json.data.current_reviewer_title);
  t1Json.data.timeline.forEach(step => {
    console.log(`  Step ${step.step_order}: ${step.stage_title} -> Status: [${step.status}] (Reviewer: ${step.reviewer_name || '-'})`);
  });

  if (t1Json.data.current_stage !== 'dept_head') {
    throw new Error(`Expected initial stage 'dept_head', got ${t1Json.data.current_stage}`);
  }

  // 4. Step Review: Dept Head Approves
  console.log('\nAction: Dept Head Approves plan...');
  const step1Res = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'เห็นชอบตามเสนอ จัดโครงสร้างรายวิชาได้ดีเยี่ยม',
      reviewer_name: 'ครูมาลี ประเสริฐยิ่ง',
      reviewer_role: 'หัวหน้ากลุ่มสาระฯ วิทยาศาสตร์และเทคโนโลยี'
    })
  });
  const step1Json = await step1Res.json();
  console.log('Step 1 result:', step1Json);

  // Check Timeline after Dept Head
  const t2Res = await fetch(`${BASE_URL}/api/plans/${planId}/timeline`);
  const t2Json = await t2Res.json();
  console.log('New Current Reviewer Stage:', t2Json.data.current_reviewer_title);
  t2Json.data.timeline.forEach(step => {
    console.log(`  Step ${step.step_order}: ${step.stage_title} -> Status: [${step.status}]`);
  });

  if (t2Json.data.current_stage !== 'curriculum_head') {
    throw new Error(`Expected stage 'curriculum_head', got ${t2Json.data.current_stage}`);
  }

  // 5. Step Review: Curriculum Head Approves
  console.log('\nAction: Curriculum Head Approves plan...');
  const step2Res = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'ผ่านการตรวจสอบมาตรฐานงานหลักสูตรสถานศึกษา',
      reviewer_name: 'ครูอรทัย งานหลักสูตร',
      reviewer_role: 'หัวหน้างานหลักสูตร'
    })
  });
  const step2Json = await step2Res.json();
  console.log('Step 2 result:', step2Json);

  // 6. Step Review: Academic Head Approves
  console.log('\nAction: Academic Head Approves plan...');
  const step3Res = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'ผ่านเกณฑ์มาตรฐานกลุ่มบริหารวิชาการ',
      reviewer_name: 'ครูปรีชา บริหารวิชาการ',
      reviewer_role: 'หัวหน้ากลุ่มบริหารวิชาการ'
    })
  });
  const step3Json = await step3Res.json();
  console.log('Step 3 result:', step3Json);

  // 7. Step Review: Academic Director Approves
  console.log('\nAction: Academic Director Approves plan...');
  const step4Res = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'ผ่านการกลั่นกรองวิชาการ เห็นควรเสนอผู้อำนวยการโรงเรียน',
      reviewer_name: 'ดร.ประสิทธิ์ ปัญญายิ่ง',
      reviewer_role: 'รองผู้อำนวยการฝ่ายวิชาการ'
    })
  });
  const step4Json = await step4Res.json();
  console.log('Step 4 result:', step4Json);

  // 8. Step Review: School Director Final Approval
  console.log('\nAction: School Director Final Approval...');
  const step5Res = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      feedback: 'อนุมัติให้ใช้จัดการเรียนการสอนประจำภาคเรียนที่ 1/2569 ได้',
      reviewer_name: 'ดร.สมศักดิ์ นำพาพัฒนา',
      reviewer_role: 'ผู้อำนวยการโรงเรียน'
    })
  });
  const step5Json = await step5Res.json();
  console.log('Step 5 result:', step5Json);

  // Check Final Timeline
  const tFinalRes = await fetch(`${BASE_URL}/api/plans/${planId}/timeline`);
  const tFinalJson = await tFinalRes.json();
  console.log('\nFinal Plan Status:', tFinalJson.data.plan.submission_status);
  console.log('Final Stage:', tFinalJson.data.current_reviewer_title);
  tFinalJson.data.timeline.forEach(step => {
    console.log(`  Step ${step.step_order}: ${step.stage_title} -> Status: [${step.status}] (Done by: ${step.reviewer_name}) - "${step.feedback}"`);
  });

  if (tFinalJson.data.plan.submission_status !== 'approved') {
    throw new Error(`Expected final status 'approved', got ${tFinalJson.data.plan.submission_status}`);
  }

  console.log('\n🎉 ALL MULTI-TIER TIMELINE & AUTH TESTS PASSED!');
}

testAuthAndTimeline().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
