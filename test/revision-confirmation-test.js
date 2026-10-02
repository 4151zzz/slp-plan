import assert from 'assert';
import path from 'path';
import fs from 'fs';

const BASE_URL = 'http://localhost:3000';

async function testRevisionFlow() {
  console.log('🧪 Starting Revision Confirmation & Reason Verification Test...\n');

  // 1. Submit a fresh plan
  const termsRes = await fetch(`${BASE_URL}/api/terms`);
  const termsJson = await termsRes.json();
  const term = termsJson.data[0];

  const teacherEmail = `test.teacher.${Date.now()}@school.ac.th`;
  const form = new FormData();
  form.append('teacher_name', 'ครูทดสอบ ตีกลับ');
  form.append('teacher_email', teacherEmail);
  form.append('teacher_department', 'วิทยาศาสตร์และเทคโนโลยี');
  form.append('grade_level', 'มัธยมศึกษาปีที่ 4');
  form.append('subject_code', 'ว31102');
  form.append('subject_name', 'ฟิสิกส์พื้นฐาน');
  form.append('academic_term_id', term.id);
  form.append('signature_data', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAALElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvBh1gAAH6cE4kAAAAAElFTkSuQmCC');

  const samplePdfPath = path.resolve('test/sample_plan.pdf');
  form.append('pdf_file', new Blob([fs.readFileSync(samplePdfPath)], { type: 'application/pdf' }), 'sample.pdf');

  const submitRes = await fetch(`${BASE_URL}/api/plans/submit`, { method: 'POST', body: form });
  const submitJson = await submitRes.json();
  assert.strictEqual(submitJson.success, true);
  const planId = submitJson.planId;
  console.log(`Submitted test plan ID: ${planId}`);

  // 2. Action: Send Back (ตีกลับให้แก้ไข) with specific reason
  const testReason = 'กรุณาเพิ่มเติมจุดประสงค์การเรียนรู้ด้านทักษะกระบวนการ (P) และแนบเกณฑ์การประเมิน (Rubric)';
  console.log(`Action: Step-review with action='revision' and feedback='${testReason}'...`);

  const revRes = await fetch(`${BASE_URL}/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'revision',
      feedback: testReason,
      reviewer_name: 'ครูมาลี ประเสริฐยิ่ง',
      reviewer_role: 'หัวหน้ากลุ่มสาระฯ วิทยาศาสตร์และเทคโนโลยี'
    })
  });
  const revJson = await revRes.json();
  assert.strictEqual(revRes.status, 200);
  assert.strictEqual(revJson.success, true);
  console.log('✅ Revision API response:', revJson);

  // 3. Verify Timeline & Plan status
  const tRes = await fetch(`${BASE_URL}/api/plans/${planId}/timeline`);
  const tJson = await tRes.json();
  assert.strictEqual(tJson.data.plan.submission_status, 'revision_needed');
  assert.strictEqual(tJson.data.plan.reviewer_feedback, testReason);

  const revStep = tJson.data.timeline.find(s => s.status === 'revision_needed');
  assert(revStep, 'Timeline must contain a step with status revision_needed');
  assert.strictEqual(revStep.feedback, testReason);
  console.log(`✅ Verified: Plan status is '${tJson.data.plan.submission_status}' with recorded reason: '${tJson.data.plan.reviewer_feedback}'`);

  console.log('\n🎉 ALL REVISION TESTS PASSED SUCCESSFULLY! 🎉\n');
}

testRevisionFlow().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
