import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createSamplePdf } from './generate-sample-pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://127.0.0.1:3000';

// Mock transparent 1x1 PNG base64 signature
const SAMPLE_SIGNATURE_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAyCAYAAACqNX6+AAAALElEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAOBvBh1gAAH6cE4kAAAAAElFTkSuQmCC';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log('=====================================================');
  console.log('🧪 Starting Automated System & Concurrency Tests');
  console.log('=====================================================');

  // 1. Ensure sample PDF exists
  const samplePdfPath = path.join(__dirname, 'sample_plan.pdf');
  await createSamplePdf(samplePdfPath);

  // 2. Fetch active terms
  console.log('\n[TEST 1] Fetching active academic terms...');
  const termsRes = await fetch(`${BASE_URL}/api/terms`);
  const termsData = await termsRes.json();
  if (!termsData.success || termsData.data.length === 0) {
    throw new Error('No academic terms found!');
  }
  const term = termsData.data[0];
  console.log(`✓ Got active term: ${term.name} (${term.id})`);

  // 3. Test Teacher 1 submission
  console.log('\n[TEST 2] Testing initial submission for Teacher A...');
  const teacherEmail = `teacher.a.${Date.now()}@school.ac.th`;

  const formA = new FormData();
  formA.append('teacher_name', 'ครูสมศักดิ์ รักเรียน');
  formA.append('teacher_email', teacherEmail);
  formA.append('teacher_department', 'วิทยาศาสตร์และเทคโนโลยี');
  formA.append('grade_level', 'มัธยมศึกษาปีที่ 4');
  formA.append('subject_code', 'ว31101');
  formA.append('subject_name', 'วิทยาการคำนวณ 1');
  formA.append('academic_term_id', term.id);
  formA.append('signature_data', SAMPLE_SIGNATURE_BASE64);
  const pdfBufferA = fs.readFileSync(samplePdfPath);
  formA.append('pdf_file', new Blob([pdfBufferA], { type: 'application/pdf' }), 'lesson_plan_cs4.pdf');

  const submitResA = await fetch(`${BASE_URL}/api/plans/submit`, {
    method: 'POST',
    body: formA
  });

  const submitDataA = await submitResA.json();
  console.log(`Response Status: ${submitResA.status}`);
  if (submitResA.status !== 202) {
    throw new Error(`Expected 202 Accepted, got ${submitResA.status}: ${JSON.stringify(submitDataA)}`);
  }
  console.log(`✓ Teacher A initial submission accepted! Job ID: ${submitDataA.jobId}, Plan ID: ${submitDataA.planId}`);

  // Wait for background queue to finish processing
  console.log('Waiting for background queue worker to stamp PDF and upload...');
  let jobDone = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const jobRes = await fetch(`${BASE_URL}/api/jobs/${submitDataA.jobId}/status`);
    const jobStatus = await jobRes.json();
    if (jobStatus.success && jobStatus.data) {
      console.log(`  Queue status: ${jobStatus.data.status} (${jobStatus.data.progress}%) - ${jobStatus.data.message}`);
      if (jobStatus.data.status === 'completed') {
        jobDone = true;
        break;
      }
    }
  }

  if (!jobDone) {
    throw new Error('Background job did not complete in expected time');
  }
  console.log('✓ Teacher A plan stamped and uploaded successfully!');

  // 4. Test Duplicate Submission (CRITICAL REQUIREMENT)
  console.log('\n[TEST 3] Testing Duplicate Submission Prevention for Teacher A in same term...');
  const formADup = new FormData();
  formADup.append('teacher_name', 'ครูสมศักดิ์ รักเรียน');
  formADup.append('teacher_email', teacherEmail); // SAME EMAIL
  formADup.append('teacher_department', 'วิทยาศาสตร์และเทคโนโลยี');
  formADup.append('grade_level', 'มัธยมศึกษาปีที่ 4');
  formADup.append('subject_code', 'ว31102'); // Trying to submit another course
  formADup.append('subject_name', 'การเขียนโปรแกรม 1');
  formADup.append('academic_term_id', term.id); // SAME TERM
  formADup.append('signature_data', SAMPLE_SIGNATURE_BASE64);
  formADup.append('pdf_file', new Blob([pdfBufferA], { type: 'application/pdf' }), 'dup_plan.pdf');

  const dupRes = await fetch(`${BASE_URL}/api/plans/submit`, {
    method: 'POST',
    body: formADup
  });

  const dupData = await dupRes.json();
  console.log(`Response Status: ${dupRes.status}`);
  if (dupRes.status === 409) {
    console.log(`✓ SUCCESS: Duplicate submission strictly BLOCKED with 409 Conflict!`);
    console.log(`  Message: "${dupData.message}"`);
    console.log(`  Can Edit Flag: ${dupData.canEdit}`);
  } else {
    throw new Error(`CRITICAL FAILURE: Expected 409 Conflict on duplicate submission, got ${dupRes.status}`);
  }

  // 5. Test Pre-flight duplicate check API
  console.log('\n[TEST 4] Testing Pre-flight Duplicate Check API...');
  const checkRes = await fetch(`${BASE_URL}/api/plans/check-duplicate?email=${encodeURIComponent(teacherEmail)}&term_id=${term.id}`);
  const checkData = await checkRes.json();
  console.log('Check API result:', checkData);
  if (!checkData.exists) {
    throw new Error('Expected duplicate check to report exists: true');
  }
  console.log('✓ Pre-flight duplicate check correctly detected existing submission.');

  // 6. Test Reviewer sets status to "revision_needed" -> teacher can now edit
  console.log('\n[TEST 5] Testing Revision Flow (Reviewer marks revision_needed -> Teacher updates plan)...');
  const reviewRes = await fetch(`${BASE_URL}/api/admin/plans/${submitDataA.planId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'revision_needed',
      feedback: 'กรุณาปรับปรุงตัวชี้วัดในหน่วยที่ 2 ให้สอดคล้องกับเกณฑ์ สพฐ.',
      reviewed_by: 'หัวหน้ากลุ่มสาระวิทย์'
    })
  });
  const reviewJson = await reviewRes.json();
  console.log('Review updated:', reviewJson);

  // Teacher updates the plan
  const updateForm = new FormData();
  updateForm.append('teacher_name', 'ครูสมศักดิ์ รักเรียน (แก้ไข)');
  updateForm.append('teacher_department', 'วิทยาศาสตร์และเทคโนโลยี');
  updateForm.append('subject_code', 'ว31101');
  updateForm.append('subject_name', 'วิทยาการคำนวณ 1 (ฉบับปรับปรุง)');
  updateForm.append('grade_level', 'มัธยมศึกษาปีที่ 4');
  updateForm.append('signature_data', SAMPLE_SIGNATURE_BASE64);

  const updateRes = await fetch(`${BASE_URL}/api/plans/${submitDataA.planId}`, {
    method: 'PUT',
    body: updateForm
  });
  const updateData = await updateRes.json();
  console.log(`Update Response Status: ${updateRes.status}`, updateData);
  if (!updateRes.ok) {
    throw new Error(`Update failed: ${JSON.stringify(updateData)}`);
  }
  console.log('✓ Existing plan successfully updated in revision mode and enqueued for re-certification!');

  // 7. Test High-Concurrency Burst (8 teachers simultaneously)
  console.log('\n[TEST 6] Testing High-Concurrency Peak Traffic (8 simultaneous submissions)...');
  const concurrentCount = 8;
  const promises = [];

  for (let i = 1; i <= concurrentCount; i++) {
    const cEmail = `concurrent.teacher.${Date.now()}.${i}@school.ac.th`;
    const cForm = new FormData();
    cForm.append('teacher_name', `ครูทดสอบ ท่านที่ ${i}`);
    cForm.append('teacher_email', cEmail);
    cForm.append('teacher_department', 'คณิตศาสตร์');
    cForm.append('grade_level', 'มัธยมศึกษาปีที่ 5');
    cForm.append('subject_code', `ค3210${i}`);
    cForm.append('subject_name', `คณิตศาสตร์เพิ่มเติม ${i}`);
    cForm.append('academic_term_id', term.id);
    cForm.append('signature_data', SAMPLE_SIGNATURE_BASE64);
    cForm.append('pdf_file', new Blob([pdfBufferA], { type: 'application/pdf' }), `math_${i}.pdf`);

    promises.push(
      fetch(`${BASE_URL}/api/plans/submit`, {
        method: 'POST',
        body: cForm
      }).then(async r => {
        const body = await r.json();
        return { status: r.status, body };
      })
    );
  }

  const results = await Promise.all(promises);
  console.log(`All ${concurrentCount} concurrent requests completed!`);

  let allAccepted = true;
  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    console.log(`  Request ${i + 1}: Status ${res.status}, Job ID: ${res.body.jobId}`);
    if (res.status !== 202) {
      allAccepted = false;
    }
  }

  if (!allAccepted) {
    throw new Error('Not all concurrent requests received 202 Accepted!');
  }
  console.log('✓ HIGH CONCURRENCY TEST PASSED: All 8 submissions non-blocking and queued without server crashes!');

  console.log('\n=====================================================');
  console.log('🎉 ALL SYSTEM & CONCURRENCY TESTS COMPLETED SUCCESSFULLY!');
  console.log('=====================================================');
}

runTests().catch(err => {
  console.error('\n❌ Test run failed:', err);
  process.exit(1);
});
