import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, db } from '../src/database/db.js';
import { pdfService } from '../src/services/pdfService.js';
import { PDFDocument } from 'pdf-lib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testRealPdf() {
  console.log('🚀 Running Full Stamping Test on Real Formatted Document: test/เทส.pdf');
  await initDatabase();

  const realPdfPath = path.resolve(__dirname, 'เทส.pdf');
  if (!fs.existsSync(realPdfPath)) {
    throw new Error('Real PDF not found at ' + realPdfPath);
  }

  const sigsPath = path.resolve(__dirname, '../data/templates/sample_signatures.json');
  const signatures = JSON.parse(fs.readFileSync(sigsPath, 'utf8'));

  const planId = 'real_test_' + Date.now();

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
      'ม.4',
      'เทส.pdf',
      signatures.teacher
    ]
  );

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

  // Step 1: Teacher submits with signature
  console.log('\n--- 1. Teacher submitting & signing ---');
  const stampedPath = await pdfService.stampSignature({
    sourcePdfPath: realPdfPath,
    signatureBase64: signatures.teacher,
    planId,
    teacherName: 'นายเอกเทศ เพ็ชรวิจิตร',
    subjectCode: 'ว31103',
    termName: '1/2569',
    signedAt: new Date()
  });
  console.log('✅ Stamped Teacher. Output:', stampedPath);
  await db.execute(`UPDATE lesson_plans SET stamped_file_path = ? WHERE id = ?`, [stampedPath, planId]);

  // Step 2: Dept Head signs
  console.log('\n--- 2. Dept Head signing ---');
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

  // Step 3: Curriculum Head signs
  console.log('\n--- 3. Curriculum Head signing ---');
  await db.execute(
    `UPDATE approval_timeline SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, reviewer_signature = ?, action_at = CURRENT_TIMESTAMP WHERE lesson_plan_id = ? AND stage_key = 'curriculum_head'`,
    ['นายสิทธิชัย สอนดี', 'หัวหน้างานหลักสูตร', 'เห็นชอบดำเนินการได้', signatures.curriculum_head, planId]
  );
  await pdfService.stampReviewerSignature({
    planId,
    stageKey: 'curriculum_head',
    signatureBase64: signatures.curriculum_head,
    reviewerName: 'นายสิทธิชัย สอนดี',
    reviewerRole: 'หัวหน้างานพัฒนาคุณภาพการจัดการเรียนการสอน',
    feedback: 'เห็นชอบดำเนินการได้',
    signedAt: new Date()
  });

  // Step 4: Academic Vice Director signs
  console.log('\n--- 4. Academic Vice Director signing ---');
  await db.execute(
    `UPDATE approval_timeline SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, reviewer_signature = ?, action_at = CURRENT_TIMESTAMP WHERE lesson_plan_id = ? AND stage_key = 'academic_director'`,
    ['นางสาวรัชนี ชูเมือง', 'รอง ผอ. วิชาการ', 'เห็นชอบเสนอ ผอ. อนุมัติ', signatures.academic_director, planId]
  );
  await pdfService.stampReviewerSignature({
    planId,
    stageKey: 'academic_director',
    signatureBase64: signatures.academic_director,
    reviewerName: 'นางสาวรัชนี ชูเมือง',
    reviewerRole: 'รองผู้อำนวยการโรงเรียน กลุ่มบริหารวิชาการ',
    feedback: 'เห็นชอบ เสนอผู้อำนวยการพิจารณาอนุมัติใช้แผนการจัดการเรียนรู้',
    signedAt: new Date()
  });

  // Step 5: Director signs
  console.log('\n--- 5. Director signing ---');
  await db.execute(
    `UPDATE approval_timeline SET status = 'completed', reviewer_name = ?, reviewer_role = ?, feedback = ?, reviewer_signature = ?, action_at = CURRENT_TIMESTAMP WHERE lesson_plan_id = ? AND stage_key = 'director'`,
    ['นางนิกูล ทองหน้าศาล', 'ผู้อำนวยการโรงเรียน', 'อนุมัติ', signatures.director, planId]
  );
  await pdfService.stampReviewerSignature({
    planId,
    stageKey: 'director',
    signatureBase64: signatures.director,
    reviewerName: 'นางนิกูล ทองหน้าศาล',
    reviewerRole: 'ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม',
    feedback: 'อนุมัติให้ใช้จัดการเรียนรู้ได้',
    signedAt: new Date()
  });

  // Synchronize Page 2
  console.log('\n--- Synchronizing Page 2 ---');
  await pdfService.syncAllSignaturesToPage2(planId);

  // Verify resulting document page count & sizes
  const resultBytes = fs.readFileSync(stampedPath);
  const resultDoc = await PDFDocument.load(resultBytes);
  const pageCount = resultDoc.getPageCount();
  console.log(`\n🎉 Verification: Resulting PDF has ${pageCount} pages (Expected: 2 pages)`);

  const previewOutputPath = path.resolve(__dirname, '../public/real_pdf_stamped_preview.pdf');
  fs.copyFileSync(stampedPath, previewOutputPath);
  console.log(`Saved preview copy to: ${previewOutputPath}`);

  process.exit(0);
}

testRealPdf().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
