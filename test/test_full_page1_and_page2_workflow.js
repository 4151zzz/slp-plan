import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, db } from '../src/database/db.js';
import { pdfService } from '../src/services/pdfService.js';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
  console.log('🚀 Starting Full 5-Tier Stamping Test for Page 1 & Page 2...');
  await initDatabase();

  const planId = 'test_plan_' + Date.now();
  const sigsPath = path.resolve(__dirname, '../data/templates/sample_signatures.json');
  const signatures = JSON.parse(fs.readFileSync(sigsPath, 'utf8'));

  // Ensure active term exists
  let term = await db.get('SELECT id FROM academic_terms LIMIT 1');
  if (!term) {
    const termId = 'term_' + Date.now();
    await db.execute(
      `INSERT INTO academic_terms (id, code, name, is_active) VALUES (?, '1/2569', 'ภาคเรียนที่ 1/2569', 1)`,
      [termId]
    );
    term = { id: termId };
  }

  // 1. Insert lesson plan record
  const sourcePdfPath = path.resolve(__dirname, '../data/templates/form_nt2_template.pdf');
  await db.execute(
    `INSERT INTO lesson_plans (
      id, academic_term_id, teacher_name, teacher_email, teacher_department,
      subject_code, subject_name, grade_level, file_original_name,
      signature_data, signed_at, submission_status, current_stage
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'submitted', 'dept_head')`,
    [
      planId,
      term.id,
      'นายเอกเทศ เพ็ชรวิจิตร',
      `ekathet.${Date.now()}@school.ac.th`,
      'วิทยาศาสตร์และเทคโนโลยี',
      'ว31103',
      'การออกแบบและเทคโนโลยี 1',
      'มัธยมศึกษาปีที่ 4',
      'แผนการสอน_ว31103.pdf',
      signatures.teacher
    ]
  );

  // Initialize approval timeline
  const stages = [
    { key: 'dept_head', order: 1, title: 'หัวหน้ากลุ่มสาระการเรียนรู้' },
    { key: 'curriculum_head', order: 2, title: 'หัวหน้างานหลักสูตร' },
    { key: 'academic_director', order: 3, title: 'รองผู้อำนวยการฝ่ายวิชาการ' },
    { key: 'director', order: 4, title: 'ผู้อำนวยการโรงเรียน' }
  ];

  for (const st of stages) {
    await db.execute(
      `INSERT INTO approval_timeline (id, lesson_plan_id, step_order, stage_key, stage_title, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`tl_${planId}_${st.key}`, planId, st.order, st.key, st.title, st.order === 1 ? 'in_progress' : 'waiting']
    );
  }

  // Step 1: Stamp Teacher Signature (Page 1 Memo + Page 2 นท.2)
  console.log('\n--- Step 1: Stamping Teacher signature ---');
  const stampedPdfPath = await pdfService.stampSignature({
    sourcePdfPath,
    signatureBase64: signatures.teacher,
    planId,
    teacherName: 'นายเอกเทศ เพ็ชรวิจิตร',
    subjectCode: 'ว31103',
    termName: '1/2569',
    signedAt: new Date()
  });
  console.log('✅ Stamped Teacher signature. Output:', stampedPdfPath);

  // Update DB stamped path
  await db.execute(`UPDATE lesson_plans SET stamped_file_path = ? WHERE id = ?`, [stampedPdfPath, planId]);

  // Step 2: Dept Head signs
  console.log('\n--- Step 2: Dept Head Approving & Signing ---');
  await db.execute(
    `UPDATE approval_timeline SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, reviewer_signature = ?, action_at = CURRENT_TIMESTAMP WHERE lesson_plan_id = ? AND stage_key = 'dept_head'`,
    ['นางวัชรี สุขสวัสดิ์', 'หัวหน้ากลุ่มสาระฯ', 'เห็นชอบตามเสนอ', signatures.dept_head, planId]
  );
  await pdfService.stampReviewerSignature({
    planId,
    stageKey: 'dept_head',
    signatureBase64: signatures.dept_head,
    reviewerName: 'นางวัชรี สุขสวัสดิ์',
    reviewerRole: 'หัวหน้ากลุ่มสาระการเรียนรู้วิทยาศาสตร์และเทคโนโลยี',
    feedback: 'เห็นชอบตามเสนอ',
    signedAt: new Date()
  });
  console.log('✅ Stamped Dept Head signature');

  // Step 3: Curriculum Head signs
  console.log('\n--- Step 3: Curriculum Head Approving & Signing ---');
  await db.execute(
    `UPDATE approval_timeline SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, reviewer_signature = ?, action_at = CURRENT_TIMESTAMP WHERE lesson_plan_id = ? AND stage_key = 'curriculum_head'`,
    ['นางสาวสมศรี วิชาการ', 'หัวหน้างานหลักสูตร', 'ผ่านเกณฑ์มาตรฐานหลักสูตรสถานศึกษา', signatures.curriculum_head, planId]
  );
  await pdfService.stampReviewerSignature({
    planId,
    stageKey: 'curriculum_head',
    signatureBase64: signatures.curriculum_head,
    reviewerName: 'นางสาวสมศรี วิชาการ',
    reviewerRole: 'หัวหน้างานหลักสูตร',
    feedback: 'ผ่านเกณฑ์มาตรฐานหลักสูตรสถานศึกษา',
    signedAt: new Date()
  });
  console.log('✅ Stamped Curriculum Head signature');

  // Step 4: Academic Director signs
  console.log('\n--- Step 4: Academic Director Approving & Signing ---');
  await db.execute(
    `UPDATE approval_timeline SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, reviewer_signature = ?, action_at = CURRENT_TIMESTAMP WHERE lesson_plan_id = ? AND stage_key = 'academic_director'`,
    ['นางสาวรัชนี ชูเมือง', 'รองผู้อำนวยการกลุ่มบริหารวิชาการ', 'เห็นควรอนุมัติให้ใช้จัดการเรียนการสอนได้', signatures.academic_director, planId]
  );
  await pdfService.stampReviewerSignature({
    planId,
    stageKey: 'academic_director',
    signatureBase64: signatures.academic_director,
    reviewerName: 'นางสาวรัชนี ชูเมือง',
    reviewerRole: 'รองผู้อำนวยการโรงเรียน กลุ่มบริหารวิชาการ',
    feedback: 'เห็นควรอนุมัติให้ใช้จัดการเรียนการสอนได้',
    signedAt: new Date()
  });
  console.log('✅ Stamped Academic Director signature');

  // Step 5: School Director signs
  console.log('\n--- Step 5: School Director Approving & Signing ---');
  await db.execute(
    `UPDATE approval_timeline SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, reviewer_signature = ?, action_at = CURRENT_TIMESTAMP WHERE lesson_plan_id = ? AND stage_key = 'director'`,
    ['นางนิกูล ทองหน้าศาล', 'ผู้อำนวยการโรงเรียน', 'อนุมัติให้ใช้แผนการจัดการเรียนรู้ได้', signatures.director, planId]
  );
  await pdfService.stampReviewerSignature({
    planId,
    stageKey: 'director',
    signatureBase64: signatures.director,
    reviewerName: 'นางนิกูล ทองหน้าศาล',
    reviewerRole: 'ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม',
    feedback: 'อนุมัติให้ใช้แผนการจัดการเรียนรู้ได้',
    signedAt: new Date()
  });
  console.log('✅ Stamped School Director signature');

  // Verify total pages in result
  const finalBytes = fs.readFileSync(stampedPdfPath);
  const finalDoc = await PDFDocument.load(finalBytes);
  console.log('\n🎉 Final PDF page count:', finalDoc.getPageCount());

  // Copy to public folder for demonstration
  const publicOut = path.resolve(__dirname, '../public/test_certified_2pages_completed.pdf');
  fs.copyFileSync(stampedPdfPath, publicOut);
  console.log('✅ Final completed certified PDF copied to:', publicOut);
}

runTest().catch(console.error);
