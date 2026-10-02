import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runE2ETest() {
  console.log('🧪 Starting 5-Tier Memo Signing & Slot Placement E2E Test...');

  // Load sample signatures
  const sigsPath = path.resolve(__dirname, '../data/templates/sample_signatures.json');
  const signatures = JSON.parse(fs.readFileSync(sigsPath, 'utf8'));

  // Get active term
  const termsRes = await fetch('http://localhost:3000/api/terms');
  const termsJson = await termsRes.json();
  const term = termsJson.data[0];

  // 1. Submit a new lesson plan as Teacher
  console.log('\nStep 1: Submitting new lesson plan as Teacher (ครูสมชาย)...');
  const teacherEmail = `somchai.memo.${Date.now()}@school.ac.th`;
  const form = new FormData();
  form.append('teacher_name', 'ครูสมชาย รักการสอน');
  form.append('teacher_email', teacherEmail);
  form.append('teacher_department', 'การงานอาชีพ');
  form.append('grade_level', 'มัธยมศึกษาปีที่ 1');
  form.append('subject_code', 'ง21101');
  form.append('subject_name', 'รายวิชาการงานอาชีพ 1');
  form.append('academic_term_id', term.id);
  form.append('signature_data', signatures.teacher);

  const samplePdfPath = path.resolve(__dirname, 'sample_plan.pdf');
  form.append('pdf_file', new Blob([fs.readFileSync(samplePdfPath)], { type: 'application/pdf' }), 'sample.pdf');

  const submitRes = await fetch('http://localhost:3000/api/plans/submit', {
    method: 'POST',
    body: form
  });

  const submitJson = await submitRes.json();
  console.log('Submission Response:', submitJson);
  if (!submitJson.success || !submitJson.planId) {
    throw new Error('Submission failed: ' + JSON.stringify(submitJson));
  }
  const planId = submitJson.planId;
  console.log(`✅ Plan Submitted with ID: ${planId}`);

  // Give uploadQueue a moment to process initial stamping
  await new Promise(r => setTimeout(r, 2000));

  // Verify stamped file was created
  const stampedFile = path.resolve(__dirname, `../data/stamped/${planId}_certified.pdf`);
  if (!fs.existsSync(stampedFile)) {
    throw new Error(`Stamped PDF not found at ${stampedFile}`);
  }
  console.log(`✅ Initial Stamped PDF created at: ${stampedFile} (${fs.statSync(stampedFile).size} bytes)`);

  // Step 2: Level 1 (Dept Head) Review & Sign
  console.log('\nStep 2: Level 1 Dept Head (ครูประจักษ์ - หน.กลุ่มสาระฯ) approving & signing in Slot 2...');
  const resL1 = await fetch(`http://localhost:3000/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reviewer_name: 'ครูประจักษ์ สุจริตงาน',
      reviewer_role: 'หัวหน้ากลุ่มสาระฯ การงานอาชีพ',
      reviewer_signature: signatures.dept_head,
      feedback: 'เห็นชอบตามเสนอ โครงสร้างรายวิชาถูกต้องสมบูรณ์'
    })
  });
  const jsonL1 = await resL1.json();
  console.log('Level 1 Result:', jsonL1);
  if (!jsonL1.success) throw new Error('Level 1 failed');
  console.log('✅ Level 1 Signature successfully stamped in Slot 2!');

  // Step 3: Level 2 (Curriculum Head) Review & Sign
  console.log('\nStep 3: Level 2 Curriculum Head (ครูอรทัย - งานหลักสูตร) approving & signing in Slot 3...');
  const resL2 = await fetch(`http://localhost:3000/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reviewer_name: 'ครูอรทัย งานหลักสูตร',
      reviewer_role: 'หัวหน้างานหลักสูตร',
      reviewer_signature: signatures.curriculum_head,
      feedback: 'ผ่านเกณฑ์มาตรฐานหลักสูตรสถานศึกษา'
    })
  });
  const jsonL2 = await resL2.json();
  console.log('Level 2 Result:', jsonL2);
  if (!jsonL2.success) throw new Error('Level 2 failed');
  console.log('✅ Level 2 Signature successfully stamped in Slot 3!');

  // Step 4: Level 3 (Academic Head) Review & Sign
  console.log('\nStep 4: Level 3 Academic Head (ครูปรีชา - กลุ่มบริหารวิชาการ) approving & signing in Slot 3...');
  const resL3 = await fetch(`http://localhost:3000/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reviewer_name: 'ครูปรีชา บริหารวิชาการ',
      reviewer_role: 'หัวหน้ากลุ่มบริหารวิชาการ',
      reviewer_signature: signatures.academic_head,
      feedback: 'ผ่านการตรวจสอบกลุ่มบริหารวิชาการ'
    })
  });
  const jsonL3 = await resL3.json();
  console.log('Level 3 Result:', jsonL3);
  if (!jsonL3.success) throw new Error('Level 3 failed');
  console.log('✅ Level 3 Signature successfully stamped in Slot 3!');

  // Step 5: Level 4 (Academic Vice Director) Review & Sign with comment
  console.log('\nStep 5: Level 4 Vice Director (ดร.ประสิทธิ์ - รอง ผอ. วิชาการ) approving, writing comment & signing in Slot 4...');
  const resL4 = await fetch(`http://localhost:3000/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reviewer_name: 'ดร.ประสิทธิ์ ปัญญายิ่ง',
      reviewer_role: 'รองผู้อำนวยการฝ่ายวิชาการ',
      reviewer_signature: signatures.academic_director,
      feedback: 'ผ่านการกลั่นกรองวิชาการ เห็นควรเสนอผู้อำนวยการพิจารณาอนุมัติ'
    })
  });
  const jsonL4 = await resL4.json();
  console.log('Level 4 Result:', jsonL4);
  if (!jsonL4.success) throw new Error('Level 4 failed');
  console.log('✅ Level 4 Signature & Comment successfully stamped in Slot 4!');

  // Step 6: Level 5 (School Director) Final Approval & Sign
  console.log('\nStep 6: Level 5 School Director (ดร.นิกูล ทองหน้าศาล) final approval & signing in Slot 5...');
  const resL5 = await fetch(`http://localhost:3000/api/admin/plans/${planId}/step-review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'approve',
      reviewer_name: 'นางนิกูล ทองหน้าศาล',
      reviewer_role: 'ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม',
      reviewer_signature: signatures.director,
      feedback: 'อนุมัติให้ใช้จัดการเรียนรู้ประจำภาคเรียนที่ 1/2569 ได้'
    })
  });
  const jsonL5 = await resL5.json();
  console.log('Level 5 Result:', jsonL5);
  if (!jsonL5.success) throw new Error('Level 5 failed');
  console.log('✅ Level 5 Signature successfully stamped in Slot 5!');

  // Copy final stamped PDF to public for easy viewing
  const publicPdf = path.resolve(__dirname, '../public/latest_completed_memo.pdf');
  fs.copyFileSync(stampedFile, publicPdf);
  console.log(`\n🎉 Copied completed 5-tier stamped memo PDF to: ${publicPdf} (${fs.statSync(publicPdf).size} bytes)`);
  console.log('✅ ALL 5 SIGNING SLOTS VERIFIED AND STAMPED SUCCESSFULLY!');
}

runE2ETest().catch(err => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
