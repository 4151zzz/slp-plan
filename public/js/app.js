/**
 * School Lesson Plan Submission Portal
 * High-Scale Asynchronous Submissions with Canvas Signature Pad,
 * Strict Duplicate Prevention, Role Authentication & Multi-Tier Approval Timeline
 */

// Global State
let signaturePad = null;
let currentSelectedFile = null;
let currentPreviewUrl = null;
let termsList = [];
let existingPlanData = null;
let isEditMode = false;
let editingPlanId = null;
let activeEventSource = null;
let adminSearchTimer = null;

// Auth & Users State
let currentUser = null;
let availableUsers = [];

document.addEventListener('DOMContentLoaded', async () => {
  initSignaturePad();
  initDragAndDrop();
  await loadTerms();
  await initAuth();
  loadAdminPlans();
});

// -------------------------------------------------------------
// 0. Authentication, Departments & User Profile Management
// -------------------------------------------------------------
let departmentsList = [];

async function initAuth() {
  try {
    // Auth Guard: If no authenticated session, redirect to login page immediately
    const saved = localStorage.getItem('activeUser');
    if (!saved) {
      window.location.href = 'login.html';
      return;
    }

    try {
      currentUser = JSON.parse(saved);
      if (!currentUser || !currentUser.email) {
        throw new Error('Invalid user session');
      }
    } catch (e) {
      localStorage.removeItem('activeUser');
      window.location.href = 'login.html';
      return;
    }

    // Load available users and departments in parallel
    const [usersRes, deptsRes] = await Promise.all([
      fetch('/api/auth/users'),
      fetch('/api/departments')
    ]);

    const usersJson = await usersRes.json();
    if (usersJson.success && usersJson.data) {
      availableUsers = usersJson.data;
      // Refresh current user info if updated on server
      const matched = availableUsers.find(u => u.email.toLowerCase() === currentUser.email.toLowerCase());
      if (matched) {
        currentUser = { ...currentUser, ...matched };
        localStorage.setItem('activeUser', JSON.stringify(currentUser));
      }
    }

    const deptsJson = await deptsRes.json();
    if (deptsJson.success && deptsJson.data) {
      departmentsList = deptsJson.data;
      populateDepartmentDropdowns(departmentsList);
    }

    updateUserUI();
  } catch (err) {
    console.error('Auth initialization failed:', err);
  }
}

function populateDepartmentDropdowns(depts) {
  const teacherDeptSelect = document.getElementById('teacherDepartment');
  const adminDeptSelect = document.getElementById('adminFilterDept');

  if (teacherDeptSelect) {
    const currentVal = teacherDeptSelect.value;
    let html = '<option value="">-- เลือกกลุ่มสาระฯ --</option>';
    depts.forEach(d => {
      html += `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`;
    });
    teacherDeptSelect.innerHTML = html;
    if (currentVal) teacherDeptSelect.value = currentVal;
  }

  if (adminDeptSelect) {
    const currentVal = adminDeptSelect.value;
    let html = '<option value="">ทุกกลุ่มสาระการเรียนรู้</option>';
    depts.forEach(d => {
      html += `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`;
    });
    adminDeptSelect.innerHTML = html;
    if (currentVal) adminDeptSelect.value = currentVal;
  }
}

function updateUserUI() {
  if (!currentUser) return;

  const avatar = document.getElementById('userAvatarIcon');
  const nameDisplay = document.getElementById('userNameDisplay');
  const roleDisplay = document.getElementById('userRoleDisplay');
  const navAdminBtn = document.getElementById('navAdminBtn');
  const profileAdminLink = document.getElementById('profileModalAdminLink');

  if (avatar) avatar.textContent = currentUser.avatar || '👤';
  if (nameDisplay) {
    nameDisplay.textContent = currentUser.name;
    nameDisplay.title = currentUser.name;
  }
  if (roleDisplay) {
    let displayRole = currentUser.position_title || getRoleTitle(currentUser.role);
    if (currentUser.role === 'dept_head' && currentUser.department) {
      displayRole = `หัวหน้ากลุ่มสาระฯ ${currentUser.department}`;
    }
    roleDisplay.textContent = displayRole;
    roleDisplay.title = currentUser.position_title || displayRole;
  }

  // Show Admin Console link for admin and reviewer roles
  const canAccessAdmin = ['admin', 'director', 'academic_director', 'academic_head', 'curriculum_head', 'dept_head'].includes(currentUser.role);
  if (navAdminBtn) navAdminBtn.style.display = canAccessAdmin ? 'inline-flex' : 'none';
  if (profileAdminLink) profileAdminLink.style.display = canAccessAdmin ? 'inline-flex' : 'none';

  // Role-Tailored View:
  // Roles below academic director can submit their own lesson plans: teacher, dept_head, curriculum_head, academic_head
  const canSubmitPlan = ['teacher', 'dept_head', 'curriculum_head', 'academic_head', 'admin'].includes(currentUser.role);

  const tabBtnAdmin = document.getElementById('tabBtnAdmin');
  const tabBtnSubmit = document.getElementById('tabBtnSubmit');
  const tabBtnTrack = document.getElementById('tabBtnTrack');

  // Submit and Track tabs are available to all roles that can submit plans
  if (tabBtnSubmit) tabBtnSubmit.style.display = canSubmitPlan ? 'inline-flex' : 'none';
  if (tabBtnTrack) tabBtnTrack.style.display = canSubmitPlan ? 'inline-flex' : 'none';

  // Admin tab is available to reviewers
  if (tabBtnAdmin) tabBtnAdmin.style.display = canAccessAdmin ? 'inline-flex' : 'none';

  if (canSubmitPlan) {
    // Auto-fill teacher form inputs for their own plan submission
    const nameInput = document.getElementById('teacherName');
    const emailInput = document.getElementById('teacherEmail');
    const deptInput = document.getElementById('teacherDepartment');

    if (nameInput && !isEditMode) nameInput.value = currentUser.name;
    if (emailInput && !isEditMode) {
      emailInput.value = currentUser.email;
      triggerDuplicateCheck();
    }
    if (deptInput && currentUser.department && !isEditMode) {
      deptInput.value = currentUser.department;
    }

    // Display Verified Teacher Banner
    const verifiedBanner = document.getElementById('verifiedTeacherBanner');
    const vAvatar = document.getElementById('verifiedTeacherAvatar');
    const vName = document.getElementById('verifiedTeacherName');
    const vSub = document.getElementById('verifiedTeacherSub');
    if (verifiedBanner) verifiedBanner.style.display = 'flex';
    if (vAvatar) vAvatar.textContent = currentUser.avatar || '👨‍🏫';
    if (vName) vName.textContent = currentUser.name;
    const roleLabel = currentUser.position_title || getRoleTitle(currentUser.role);
    if (vSub) vSub.textContent = `${currentUser.email} • ${roleLabel} • กลุ่มสาระฯ ${currentUser.department || 'ทั่วไป'}`;

    // Auto-search personal submission history in track tab
    const trackEmail = document.getElementById('trackSearchEmail');
    if (trackEmail) {
      trackEmail.value = currentUser.email;
      searchTeacherHistory(false);
    }
  } else {
    const verifiedBanner = document.getElementById('verifiedTeacherBanner');
    if (verifiedBanner) verifiedBanner.style.display = 'none';
  }

  // Initial tab selection upon login:
  if (currentUser.role === 'teacher') {
    switchTab('submit');
  } else {
    // Reviewers: switch to admin tab by default, but can easily switch to submit tab to submit their own plan!
    if (currentUser.role === 'dept_head') {
      const adminDept = document.getElementById('adminFilterDept');
      if (adminDept && currentUser.department) {
        adminDept.value = currentUser.department;
      }
    }
    switchTab('admin');
    setAdminFilterMode('my_turn');
  }
}

function openUserProfileModal() {
  if (!currentUser) return;
  
  const avatar = document.getElementById('profileModalAvatar');
  const name = document.getElementById('profileModalName');
  const role = document.getElementById('profileModalRole');
  const email = document.getElementById('profileModalEmail');
  const dept = document.getElementById('profileModalDept');
  const pos = document.getElementById('profileModalPosition');

  if (avatar) avatar.textContent = currentUser.avatar || '👤';
  if (name) name.textContent = currentUser.name;
  if (role) role.textContent = currentUser.position_title || getRoleTitle(currentUser.role);
  if (email) email.textContent = currentUser.email;
  if (dept) dept.textContent = currentUser.department || '-';
  if (pos) pos.textContent = currentUser.position_title || '-';

  const modal = document.getElementById('userProfileModal');
  if (modal) modal.classList.add('active');
}

function closeUserProfileModal() {
  const modal = document.getElementById('userProfileModal');
  if (modal) modal.classList.remove('active');
}

function handleLogout() {
  document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
  Swal.fire({
    title: 'ยืนยันการออกจากระบบ?',
    text: 'คุณต้องการออกจากระบบการส่งและตรวจแผนการสอนหรือไม่',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#2563eb',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'ใช่, ออกจากระบบ',
    cancelButtonText: 'ยกเลิก'
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.removeItem('activeUser');
      Swal.fire({
        icon: 'success',
        title: 'ออกจากระบบเรียบร้อย',
        timer: 1000,
        showConfirmButton: false
      });
      setTimeout(() => {
        window.location.href = 'login.html';
      }, 900);
    }
  });
}

function getRoleTitle(role) {
  const map = {
    teacher: 'ครูผู้สอน',
    dept_head: 'หัวหน้ากลุ่มสาระฯ',
    curriculum_head: 'หัวหน้างานหลักสูตร',
    academic_head: 'หัวหน้ากลุ่มบริหารวิชาการ',
    academic_director: 'รอง ผอ. ฝ่ายวิชาการ',
    director: 'ผู้อำนวยการโรงเรียน',
    admin: 'ผู้ดูแลระบบคอมพิวเตอร์'
  };
  return map[role] || role;
}

// -------------------------------------------------------------
// 1. Signature Pad Management (HTML5 Canvas)
// -------------------------------------------------------------
function initSignaturePad() {
  const canvas = document.getElementById('signatureCanvas');
  const wrapper = document.getElementById('canvasWrapper');

  function resizeCanvas() {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    if (canvas.width !== wrapper.clientWidth * ratio) {
      const data = signaturePad && !signaturePad.isEmpty() ? signaturePad.toData() : null;
      canvas.width = wrapper.clientWidth * ratio;
      canvas.height = wrapper.clientHeight * ratio;
      canvas.getContext('2d').scale(ratio, ratio);
      if (signaturePad && data) {
        signaturePad.fromData(data);
      }
    }
  }

  if (typeof SignaturePad !== 'undefined') {
    signaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255, 255, 255, 0)',
      penColor: '#0f172a',
      minWidth: 1.5,
      maxWidth: 3.5,
      throttle: 16
    });
  } else {
    signaturePad = createFallbackSignaturePad(canvas);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
}

function clearSignature() {
  if (signaturePad) {
    signaturePad.clear();
    document.getElementById('signatureFeedback').textContent = '';
  }
}

function createFallbackSignaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let isDrawing = false;
  let hasDrawn = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function startDraw(e) {
    isDrawing = true;
    hasDrawn = true;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }

  function stopDraw() { isDrawing = false; }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', draw);
  window.addEventListener('mouseup', stopDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', draw, { passive: false });
  window.addEventListener('touchend', stopDraw);

  return {
    clear: () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawn = false;
    },
    isEmpty: () => !hasDrawn,
    toDataURL: (type = 'image/png') => canvas.toDataURL(type),
    toData: () => null,
    fromData: () => {}
  };
}

// -------------------------------------------------------------
// 2. Drag & Drop and PDF Preview Panel
// -------------------------------------------------------------
function initDragAndDrop() {
  const dropzone = document.getElementById('fileDropzone');

  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      validateAndSetFile(files[0]);
    }
  });
}

function handleFileSelected(event) {
  const file = event.target.files[0];
  if (file) validateAndSetFile(file);
}

function validateAndSetFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
    Swal.fire({
      icon: 'warning',
      title: 'รูปแบบไฟล์ไม่ถูกต้อง',
      text: 'กรุณาเลือกไฟล์เอกสารรูปแบบ PDF เท่านั้น',
      confirmButtonColor: '#2563eb',
      confirmButtonText: 'รับทราบ'
    });
    return;
  }

  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    Swal.fire({
      icon: 'warning',
      title: 'ขนาดไฟล์เกินกำหนด',
      text: 'ขนาดไฟล์เกิน 50MB กรุณาย่อขนาดเอกสารก่อนอัปโหลด',
      confirmButtonColor: '#2563eb',
      confirmButtonText: 'รับทราบ'
    });
    return;
  }

  currentSelectedFile = file;

  document.getElementById('selectedFileName').textContent = file.name;
  document.getElementById('selectedFileSize').textContent = `(${formatBytes(file.size)})`;
  document.getElementById('fileBadge').classList.add('active');
  document.getElementById('fileDropzone').style.display = 'none';

  if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
  currentPreviewUrl = URL.createObjectURL(file);

  const previewFrame = document.getElementById('pdfPreviewFrame');
  previewFrame.src = currentPreviewUrl;

  document.getElementById('previewPlaceholder').style.display = 'none';
  document.getElementById('previewFrameWrap').classList.add('active');
  document.getElementById('pdfPageInfo').textContent = `${formatBytes(file.size)}`;
  document.getElementById('pdfPageInfo').className = 'badge badge-submitted';
}

function clearSelectedFile(e) {
  if (e) e.stopPropagation();
  currentSelectedFile = null;
  document.getElementById('pdfFileInput').value = '';
  document.getElementById('fileBadge').classList.remove('active');
  document.getElementById('fileDropzone').style.display = 'block';

  if (currentPreviewUrl) {
    URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }
  document.getElementById('pdfPreviewFrame').src = '';
  document.getElementById('previewFrameWrap').classList.remove('active');
  document.getElementById('previewPlaceholder').style.display = 'flex';
  document.getElementById('pdfPageInfo').textContent = 'รอแนบไฟล์';
  document.getElementById('pdfPageInfo').className = 'badge badge-draft';
}

function openPdfInNewTab() {
  if (currentPreviewUrl) {
    window.open(currentPreviewUrl, '_blank');
  } else {
    const frame = document.getElementById('pdfPreviewFrame');
    if (frame && frame.src && frame.src !== 'about:blank' && !frame.src.endsWith('/about:blank')) {
      window.open(frame.src, '_blank');
    } else {
      Swal.fire({
        icon: 'info',
        title: 'ยังไม่มีไฟล์ตัวอย่าง',
        text: 'กรุณาแนบไฟล์แผนการสอน (PDF) เพื่อดูตัวอย่างในแท็บใหม่',
        confirmButtonColor: '#2563eb'
      });
    }
  }
}

// -------------------------------------------------------------
// 3. Academic Terms & Duplicate Check Business Logic
// -------------------------------------------------------------
async function loadTerms() {
  try {
    const res = await fetch('/api/terms');
    const json = await res.json();
    if (json.success && json.data.length > 0) {
      termsList = json.data;
      const termSelect = document.getElementById('academicTerm');
      const adminTermSelect = document.getElementById('adminFilterTerm');

      termSelect.innerHTML = '';
      adminTermSelect.innerHTML = '<option value="">ทุกภาคเรียน</option>';

      let activeTermText = '';
      let activeTermId = '';
      termsList.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = `${t.name} ${t.is_active ? ' (เปิดรับแผน)' : ' (ปิดรับแผน)'}`;
        termSelect.appendChild(opt);

        const adminOpt = document.createElement('option');
        adminOpt.value = t.id;
        adminOpt.textContent = t.name;
        adminTermSelect.appendChild(adminOpt);

        if (t.is_active && !activeTermText) {
          activeTermText = t.name;
          activeTermId = t.id;
          termSelect.value = t.id;
        }
      });

      const badge = document.getElementById('activeTermBadge');
      if (badge) {
        if (activeTermText) {
          badge.textContent = activeTermText;
          badge.className = 'badge badge-approved';
        } else {
          badge.textContent = 'ปิดรับแผนการสอนชั่วคราว';
          badge.className = 'badge badge-revision_needed';
        }
      }
    }
  } catch (err) {
    console.error('Failed to load terms:', err);
  }
}

async function triggerDuplicateCheck() {
  const emailInput = document.getElementById('teacherEmail');
  const termSelect = document.getElementById('academicTerm');
  const feedback = document.getElementById('emailFeedback');
  const banner = document.getElementById('duplicateAlertBanner');

  const email = emailInput.value.trim();
  const termId = termSelect.value;

  if (!email || !email.includes('@') || !termId) {
    feedback.textContent = '';
    banner.style.display = 'none';
    existingPlanData = null;
    return;
  }

  if (isEditMode) return;

  try {
    const res = await fetch(`/api/plans/check-duplicate?email=${encodeURIComponent(email)}&term_id=${encodeURIComponent(termId)}`);
    const data = await res.json();

    if (data.exists) {
      existingPlanData = data.plan;

      banner.style.display = 'flex';
      document.getElementById('dupBannerTitle').textContent = data.message;
      document.getElementById('dupBannerBody').innerHTML = `
        ท่านได้ส่งแผนวิชา <strong>${data.plan.subject_code} - ${data.plan.subject_name}</strong> ไว้แล้ว<br>
        สถานะ: <strong>${getStatusLabel(data.plan.submission_status)}</strong> (ส่งเมื่อ: ${formatDate(data.plan.created_at)})
      `;

      const driveBtn = document.getElementById('btnViewExistingDrive');
      if (data.plan.google_drive_view_link) {
        driveBtn.href = data.plan.google_drive_view_link;
        driveBtn.style.display = 'inline-flex';
      } else {
        driveBtn.style.display = 'none';
      }

      const editBtn = document.getElementById('btnEditExistingBanner');
      if (data.canEdit) {
        editBtn.style.display = 'inline-flex';
        feedback.className = 'input-feedback error';
        feedback.textContent = 'พบแผนการสอนเดิมในระบบ (สามารถแก้ไขหรือส่งฉบับปรับปรุงได้)';
      } else {
        editBtn.style.display = 'none';
        feedback.className = 'input-feedback error';
        feedback.textContent = 'คุณส่งแผนสำหรับภาคเรียนนี้ไปแล้ว และไม่อยู่ในสถานะที่แก้ไขได้';
      }

    } else {
      banner.style.display = 'none';
      existingPlanData = null;
      feedback.className = 'input-feedback success';
      feedback.textContent = '✓ อีเมลนี้ยังไม่มีประวัติการส่งในภาคเรียนที่เลือก สามารถส่งได้';
    }
  } catch (err) {
    console.warn('Duplicate check error:', err);
  }
}

// -------------------------------------------------------------
let currentSubmissionRound = 1;

function handleSubmissionRoundChange(roundNum) {
  currentSubmissionRound = parseInt(roundNum, 10) === 2 ? 2 : 1;
  const hintEl = document.getElementById('submissionRoundHint');
  if (hintEl) {
    if (currentSubmissionRound === 2) {
      hintEl.innerHTML = '<i class="fa-solid fa-circle-info" style="color: #0d9488;"></i> ส่งครั้งที่ 2 ของภาคเรียน ลายเซ็นจะประทับลงในช่อง <strong>ครั้งที่ 2 (คอลัมน์ขวา)</strong> บนหน้าบันทึกข้อความเดิม';
    } else {
      hintEl.innerHTML = '<i class="fa-solid fa-circle-info text-primary"></i> ส่งครั้งแรกของภาคเรียน ลายเซ็นจะประทับลงในช่อง <strong>ครั้งที่ 1 (คอลัมน์ซ้าย)</strong>';
    }
  }
}

// 4. Form Submission & Real-Time Non-blocking Queue Progress
// -------------------------------------------------------------
async function handleFormSubmit(e) {
  e.preventDefault();

  if (window.isPlanSubmitting) {
    console.warn('Submission already in progress, ignoring duplicate submit');
    return;
  }

  const submitBtn = document.getElementById('btnSubmitPlan');
  const origBtnHtml = submitBtn ? submitBtn.innerHTML : '<i class="fa-solid fa-paper-plane"></i> ยืนยันและส่งแผนการสอน';
  const resetSubmitBtn = () => {
    window.isPlanSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml;
    }
  };

  window.isPlanSubmitting = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่งข้อมูล...';
  }

  const teacherName = document.getElementById('teacherName').value.trim();
  const teacherEmail = document.getElementById('teacherEmail').value.trim();
  const termId = document.getElementById('academicTerm').value;
  const department = document.getElementById('teacherDepartment').value;
  const gradeLevel = document.getElementById('gradeLevel').value;
  const subjectCode = document.getElementById('subjectCode').value.trim();
  const subjectName = document.getElementById('subjectName').value.trim();

  // Validate if term is active for new submissions
  const selectedTermObj = termsList.find(t => t.id === termId);
  if (!isEditMode && selectedTermObj && !selectedTermObj.is_active) {
    resetSubmitBtn();
    Swal.fire({
      icon: 'warning',
      title: 'ภาคเรียนนี้ปิดรับแผนการสอนแล้ว',
      text: `ระบบปิดรับการส่งแผนการสอนสำหรับ "${selectedTermObj.name}" แล้วในขณะนี้ (อนุญาตให้ส่งได้เฉพาะแผนเดิมที่ได้รับแจ้งให้ส่งกลับแก้ไข)`,
      confirmButtonColor: '#2563eb'
    });
    return;
  }

  if (!signaturePad || signaturePad.isEmpty()) {
    resetSubmitBtn();
    document.getElementById('signatureFeedback').textContent = '⚠️ กรุณาลงลายมือชื่ออิเล็กทรอนิกส์ในกรอบด้านบน';
    document.getElementById('signatureCanvas').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  document.getElementById('signatureFeedback').textContent = '';

  if (!isEditMode && !currentSelectedFile) {
    resetSubmitBtn();
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาแนบไฟล์แผนการสอน (PDF)',
      text: 'จำเป็นต้องแนบไฟล์เอกสาร PDF เพื่อประกอบการประทับตราและส่งตรวจ',
      confirmButtonColor: '#2563eb'
    });
    return;
  }

  const roundRadio = document.querySelector('input[name="submission_round"]:checked');
  const subRound = roundRadio ? parseInt(roundRadio.value, 10) : (typeof currentSubmissionRound !== 'undefined' ? currentSubmissionRound : 1);

  const signatureData = signaturePad.toDataURL('image/png');

  openQueueModal();
  updateQueueUI({ status: 'validating', progress: 25, message: 'กำลังตรวจสอบไฟล์และข้อมูล...' });

  let fileToUpload = currentSelectedFile;

  // Helper to reliably convert base64 dataURL to Uint8Array without network fetch()
  function base64ToUint8Array(dataUrl) {
    const parts = dataUrl.split(',');
    const b64 = parts.length > 1 ? parts[1] : parts[0];
    const binaryStr = atob(b64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  }

  // Client-Side High-Fidelity PDF Stamping (Stamp Teacher Signature directly onto Page 1 of the attached PDF)
  if (currentSelectedFile && window.PDFLib) {
    try {
      updateQueueUI({ status: 'stamping_signature', progress: 40, message: 'กำลังประทับตราลายมือชื่อดิจิทัลลงในเอกสาร PDF...' });

      const fileBuffer = await currentSelectedFile.arrayBuffer();
      const pdfDoc = await PDFLib.PDFDocument.load(fileBuffer, { ignoreEncryption: true });

      const pages = pdfDoc.getPages();
      if (pages.length > 0) {
        const targetPage = pages[0];

        // Stamp Teacher Signature in Column 1 or 2
        const isCol2 = subRound === 2;
        const scaleX = targetPage.getWidth() / 723;
        const scaleY = targetPage.getHeight() / 1024;
        const toPdfX = (imgX) => imgX * scaleX;
        const toPdfY = (imgY) => targetPage.getHeight() - (imgY * scaleY);

        // Embed teacher's signature safely using pure byte conversion
        const sigPngBytes = base64ToUint8Array(signatureData);
        const sigImage = await pdfDoc.embedPng(sigPngBytes);

        const sigSlotX = toPdfX(isCol2 ? 502 : 195);
        const sigSlotY = toPdfY(550);
        const renderW = 75 * scaleX;
        const renderH = 25 * scaleY;

        targetPage.drawImage(sigImage, {
          x: sigSlotX - (renderW / 2),
          y: sigSlotY - (renderH / 2) + 2,
          width: renderW,
          height: renderH
        });

        // Save stamped PDF
        const stampedPdfBytes = await pdfDoc.save();
        fileToUpload = new File([stampedPdfBytes], currentSelectedFile.name, { type: 'application/pdf' });
        console.log('✅ PDF Stamped directly onto Page 1 successfully! Size:', stampedPdfBytes.byteLength);
      }
    } catch (stampErr) {
      console.warn('Client-side PDF stamp notice:', stampErr);
      fileToUpload = currentSelectedFile;
    }
  }

  const formData = new FormData();
  formData.append('teacher_name', teacherName);
  formData.append('teacher_email', teacherEmail);
  formData.append('academic_term_id', termId);
  formData.append('teacher_department', department);
  formData.append('grade_level', gradeLevel);
  formData.append('subject_code', subjectCode);
  formData.append('subject_name', subjectName);
  formData.append('signature_data', signatureData);
  formData.append('submission_round', subRound);

  if (fileToUpload) {
    formData.append('pdf_file', fileToUpload);
  }

  const url = isEditMode ? `/api/plans/${editingPlanId}` : '/api/plans/submit';
  const method = isEditMode ? 'PUT' : 'POST';

  updateQueueUI({ status: 'uploading_drive', progress: 55, message: 'กำลังนำส่งไฟล์ขึ้น Google Drive และจัดระเบียบโฟลเดอร์...' });

  // Dynamic progress ticker to keep UI lively and prevent perception of freezing
  let currentProgress = 55;
  const progressTicker = setInterval(() => {
    if (currentProgress < 92) {
      currentProgress += 7;
      let msg = 'กำลังนำส่งไฟล์ขึ้น Google Drive และบันทึกข้อมูล...';
      if (currentProgress >= 70) msg = 'กำลังจัดระเบียบโฟลเดอร์กลุ่มสาระฯ และออกรหัสกำกับเอกสาร...';
      if (currentProgress >= 85) msg = 'กำลังบันทึกประวัติการส่งและประสานงานระบบอนุมัติ...';
      updateQueueUI({ status: 'uploading_drive', progress: currentProgress, message: msg });
    }
  }, 1100);

  try {
    const response = await fetch(url, { method, body: formData });
    clearInterval(progressTicker);
    const result = await response.json();

    if (response.status === 409) {
      resetSubmitBtn();
      closeQueueModal();
      showDuplicateModal(result);
      return;
    }

    if (!response.ok) {
      throw new Error(result.message || 'เกิดข้อผิดพลาดในการส่งข้อมูล');
    }

    if (result.jobId) {
      connectToJobEvents(result.jobId, result.planId);
    } else {
      // Synchronous Flow: complete to 100%
      updateQueueUI({
        status: 'completed',
        progress: 100,
        message: result.message || 'ส่งแผนการสอนสำเร็จ ระบบได้บันทึกข้อมูลและนำส่ง Google Drive เรียบร้อยแล้ว',
        driveViewLink: result.driveViewLink
      }, result.planId);
    }
  } catch (err) {
    resetSubmitBtn();
    clearInterval(progressTicker);
    closeQueueModal();
    Swal.fire({
      icon: 'error',
      title: 'เกิดข้อผิดพลาด',
      text: err.message,
      confirmButtonColor: '#2563eb'
    });
  } finally {
    resetSubmitBtn();
  }
}

function connectToJobEvents(jobId, planId) {
  if (activeEventSource) activeEventSource.close();

  const evtSource = new EventSource(`/api/jobs/${jobId}/events`);
  activeEventSource = evtSource;

  evtSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateQueueUI(data, planId);
      if (data.status === 'completed' || data.status === 'failed') {
        evtSource.close();
        activeEventSource = null;
      }
    } catch (e) {
      console.error('SSE parse error:', e);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    activeEventSource = null;
    pollJobStatus(jobId, planId);
  };
}

async function pollJobStatus(jobId, planId) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}/status`);
      const json = await res.json();
      if (json.success && json.data) {
        updateQueueUI(json.data, planId);
        if (json.data.status === 'completed' || json.data.status === 'failed') {
          clearInterval(interval);
        }
      }
    } catch (e) {
      clearInterval(interval);
    }
  }, 1000);
}

function updateQueueUI(job, planId) {
  const progressBar = document.getElementById('queueProgressBar');
  const statusMsg = document.getElementById('queueStatusMessage');

  progressBar.style.width = `${job.progress || 10}%`;
  statusMsg.textContent = job.message || 'กำลังประมวลผล...';

  const stepValidating = document.getElementById('step-validating');
  const stepStamping = document.getElementById('step-stamping');
  const stepUploading = document.getElementById('step-uploading');
  const stepCompleted = document.getElementById('step-completed');

  if (job.status === 'validating') {
    stepValidating.className = 'queue-step active';
  } else if (job.status === 'stamping_signature') {
    stepValidating.className = 'queue-step done';
    stepStamping.className = 'queue-step active';
  } else if (job.status === 'uploading_drive') {
    stepValidating.className = 'queue-step done';
    stepStamping.className = 'queue-step done';
    stepUploading.className = 'queue-step active';
  } else if (job.status === 'completed') {
    stepValidating.className = 'queue-step done';
    stepStamping.className = 'queue-step done';
    stepUploading.className = 'queue-step done';
    stepCompleted.className = 'queue-step done';

    document.getElementById('modalSpinner').className = 'fa-solid fa-circle-check';
    document.getElementById('modalSpinner').style.color = '#10b981';
    
    const driveBtn = document.getElementById('btnQueueDriveLink');
    if (driveBtn) {
      if (job.driveViewLink) {
        driveBtn.href = job.driveViewLink;
        driveBtn.style.display = 'inline-flex';
      } else {
        driveBtn.style.display = 'none';
      }
    }
    
    document.getElementById('queueModalFooter').style.display = 'flex';
  } else if (job.status === 'failed') {
    statusMsg.textContent = '❌ ล้มเหลว: ' + (job.error_message || job.message);
    statusMsg.style.color = '#ef4444';
    document.getElementById('modalSpinner').className = 'fa-solid fa-circle-xmark';
    document.getElementById('modalSpinner').style.color = '#ef4444';
    document.getElementById('queueModalFooter').style.display = 'flex';
  }
}

function openQueueModal() {
  const modal = document.getElementById('queueProgressModal');
  modal.classList.add('active');
  document.getElementById('queueModalFooter').style.display = 'none';
  const driveBtn = document.getElementById('btnQueueDriveLink');
  if (driveBtn) driveBtn.style.display = 'none';
  document.getElementById('queueProgressBar').style.width = '10%';
  document.getElementById('modalSpinner').className = 'fa-solid fa-spinner fa-spin';
  document.getElementById('modalSpinner').style.color = '#1e3a8a';
  document.getElementById('step-validating').className = 'queue-step active';
  document.getElementById('step-stamping').className = 'queue-step';
  document.getElementById('step-uploading').className = 'queue-step';
  document.getElementById('step-completed').className = 'queue-step';
}

function closeQueueModal() {
  document.getElementById('queueProgressModal').classList.remove('active');
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
}

function closeQueueModalAndReset() {
  closeQueueModal();
  resetSubmissionForm();
  loadAdminPlans();
  if (currentUser && currentUser.email) searchTeacherHistory();
}

function resetSubmissionForm() {
  cancelEditMode();
  document.getElementById('lessonPlanForm').reset();
  clearSignature();
  clearSelectedFile();
  document.getElementById('duplicateAlertBanner').style.display = 'none';
  document.getElementById('emailFeedback').textContent = '';
  existingPlanData = null;
  updateUserUI();
}

// -------------------------------------------------------------
// 5. Duplicate Modal & Edit Existing Plan Handler
// -------------------------------------------------------------
function showDuplicateModal(res) {
  const modal = document.getElementById('duplicateModal');
  const plan = res.existingPlan || {};

  document.getElementById('dupModalSubject').textContent = `${plan.subject_code || '-'} (${plan.subject_name || '-'})`;
  document.getElementById('dupModalStatus').innerHTML = getStatusBadge(plan.submission_status);
  document.getElementById('dupModalDate').textContent = formatDate(plan.created_at);

  if (plan.reviewer_feedback) {
    document.getElementById('dupModalFeedbackRow').style.display = 'block';
    document.getElementById('dupModalFeedback').textContent = plan.reviewer_feedback;
  } else {
    document.getElementById('dupModalFeedbackRow').style.display = 'none';
  }

  const editBtn = document.getElementById('btnEditFromModal');
  const notice = document.getElementById('dupModalNotice');

  if (res.canEdit) {
    editBtn.style.display = 'inline-flex';
    notice.textContent = 'แผนการสอนนี้อยู่ในสถานะที่สามารถแก้ไข / ส่งฉบับปรับปรุงได้';
    existingPlanData = plan;
  } else {
    editBtn.style.display = 'none';
    notice.textContent = 'แผนการสอนนี้ได้รับการบันทึกหรืออนุมัติแล้ว จึงไม่สามารถส่งใหม่หรือแก้ไขซ้ำได้';
  }

  modal.classList.add('active');
}

function closeDuplicateModal() {
  document.getElementById('duplicateModal').classList.remove('active');
}

function prepareEditFromBanner() {
  if (existingPlanData) loadPlanIntoEditMode(existingPlanData);
}

function proceedToEditFromModal() {
  closeDuplicateModal();
  if (existingPlanData) loadPlanIntoEditMode(existingPlanData);
}

async function loadPlanIntoEditMode(planOrId) {
  if (!planOrId) return;
  isEditMode = true;
  const planId = (typeof planOrId === 'object' && planOrId) ? planOrId.id : String(planOrId);
  editingPlanId = planId;

  try {
    const res = await fetch(`/api/plans/${planId}`);
    const json = await res.json();
    const p = json.data || (typeof planOrId === 'object' ? planOrId : null);
    if (!p) throw new Error('ไม่พบข้อมูลแผนการสอน');

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined && val !== null) el.value = val;
    };

    setVal('editPlanId', p.id);
    setVal('academicTerm', p.academic_term_id);
    setVal('teacherName', p.teacher_name);
    setVal('teacherEmail', p.teacher_email);
    setVal('teacherDepartment', p.teacher_department);
    setVal('gradeLevel', p.grade_level);
    setVal('subjectCode', p.subject_code);
    setVal('subjectName', p.subject_name);

    const editNotice = document.getElementById('editModeNotice');
    if (editNotice) editNotice.style.display = 'flex';

    const editPlanIdDisplay = document.getElementById('editingPlanIdDisplay');
    if (editPlanIdDisplay) editPlanIdDisplay.textContent = `${p.subject_code || ''} - ${p.subject_name || ''}`;

    const modeBadge = document.getElementById('modeBadge');
    if (modeBadge) {
      modeBadge.textContent = 'โหมดแก้ไข';
      modeBadge.className = 'badge badge-under_review';
    }

    const fileMarker = document.getElementById('fileRequiredMarker');
    if (fileMarker) fileMarker.textContent = '(เลือกไฟล์ใหม่เฉพาะเมื่อต้องการเปลี่ยน)';

    const submitBtn = document.getElementById('btnSubmitPlan');
    if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> บันทึกและส่งฉบับปรับปรุง';

    const headerTitle = document.getElementById('formHeaderTitle');
    if (headerTitle) headerTitle.textContent = 'แก้ไข / ส่งแผนการสอนฉบับปรับปรุง';

    const dupBanner = document.getElementById('duplicateAlertBanner');
    if (dupBanner) dupBanner.style.display = 'none';

    switchTab('submit');
    const panel = document.getElementById('panelSubmit');
    if (panel) panel.scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    console.error('Failed to load plan into edit:', e);
    Swal.fire({
      icon: 'error',
      title: 'ไม่สามารถโหลดแผนเพื่อแก้ไขได้',
      text: e.message || 'กรุณาลองใหม่อีกครั้ง'
    });
  }
}

function cancelEditMode() {
  isEditMode = false;
  editingPlanId = null;

  const editIdEl = document.getElementById('editPlanId');
  if (editIdEl) editIdEl.value = '';

  const editNotice = document.getElementById('editModeNotice');
  if (editNotice) editNotice.style.display = 'none';

  const modeBadge = document.getElementById('modeBadge');
  if (modeBadge) {
    modeBadge.textContent = 'ส่งใหม่';
    modeBadge.className = 'badge badge-submitted';
  }

  const fileMarker = document.getElementById('fileRequiredMarker');
  if (fileMarker) fileMarker.textContent = '*';

  const submitBtn = document.getElementById('btnSubmitPlan');
  if (submitBtn) submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ยืนยันและส่งแผนการสอน';

  const headerTitle = document.getElementById('formHeaderTitle');
  if (headerTitle) headerTitle.textContent = 'ส่งแผนการสอนประจำภาคเรียน';
}

// -------------------------------------------------------------
// 6. Approval Workflow Timeline Stepper Visualizer
// -------------------------------------------------------------
let currentTimelinePlanData = null;
let currentTimelineRound = 1;

function renderTimelineStepList(list, timeline) {
  const roleAvatars = {
    dept_head: '👩‍💼',
    curriculum_head: '📋',
    academic_head: '📚',
    academic_director: '👨‍💼',
    director: '🏛️'
  };

  let stepsHtml = '';
  timeline.forEach(step => {
    let icon = '<i class="fa-solid fa-hourglass-start"></i>';
    let statusLabel = 'รอตามลำดับ';
    let badgeClass = 'badge-draft';
    const roleAvatar = roleAvatars[step.stage_key] || '👤';

    if (step.status === 'completed') {
      icon = '<i class="fa-solid fa-check"></i>';
      statusLabel = 'ผ่านการตรวจแล้ว';
      badgeClass = 'badge-approved';
    } else if (step.status === 'in_progress') {
      icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
      statusLabel = '⏳ กำลังอยู่ระหว่างตรวจ';
      badgeClass = 'badge-submitted';
    } else if (step.status === 'revision_needed') {
      icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
      statusLabel = '⚠️ ส่งกลับแก้ไข';
      badgeClass = 'badge-revision_needed';
    }

    stepsHtml += `
      <div class="timeline-step ${step.status}">
        <div class="timeline-line"></div>
        <div class="timeline-node">${icon}</div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-title">${roleAvatar} ${escapeHtml(step.stage_title)}</span>
            <span class="badge ${badgeClass}">${statusLabel}</span>
          </div>
          <div class="timeline-desc">
            ${step.reviewer_name ? `<strong>ผู้ดำเนินการ:</strong> ${escapeHtml(step.reviewer_name)}` : '<em>รอผู้ตรวจประจำขั้นดำเนินการ</em>'}
            ${step.action_at ? `<span class="timeline-time" style="margin-left: 8px;">(${formatDate(step.action_at)})</span>` : ''}
          </div>
          ${step.feedback ? `
            <div class="timeline-feedback-box">
              <i class="fa-solid fa-comment-dots" style="margin-right: 4px;"></i>
              <strong>ความเห็น:</strong> ${escapeHtml(step.feedback)}
            </div>
          ` : ''}
          ${step.reviewer_signature ? `
            <div style="margin-top: 6px;">
              <span style="font-size: 0.72rem; color: #64748b;">ลายเซ็นผู้ตรวจ:</span><br>
              <img src="${step.reviewer_signature}" alt="ลายมือชื่อผู้ตรวจ" style="height: 38px; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 2px 6px; background: #fff;" />
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });

  list.innerHTML = stepsHtml;
}

function switchTimelineRound(roundNum) {
  currentTimelineRound = parseInt(roundNum, 10) === 2 ? 2 : 1;
  const btn1 = document.getElementById('btnTimelineRound1');
  const btn2 = document.getElementById('btnTimelineRound2');
  if (btn1 && btn2) {
    if (currentTimelineRound === 1) {
      btn1.classList.add('active');
      btn2.classList.remove('active', 'round-2');
    } else {
      btn1.classList.remove('active');
      btn2.classList.add('active', 'round-2');
    }
  }

  if (!currentTimelinePlanData) return;
  const list = document.getElementById('timelineStepperList');
  const timeline = currentTimelineRound === 2 
    ? (currentTimelinePlanData.timeline_round_2 || []) 
    : (currentTimelinePlanData.timeline_round_1 || currentTimelinePlanData.timeline || []);

  if (!timeline || timeline.length === 0) {
    list.innerHTML = `<div style="text-align: center; padding: 2rem; color: #64748b;">
      <i class="fa-solid fa-clock-rotate-left"></i> ยังไม่มีข้อมูลการตรวจสำหรับ ครั้งที่ ${currentTimelineRound}
    </div>`;
    return;
  }

  renderTimelineStepList(list, timeline);
}

async function openTimelineModal(planId) {
  const modal = document.getElementById('timelineModal');
  const banner = document.getElementById('timelineCurrentReviewerBanner');
  const badge = document.getElementById('timelinePlanCodeBadge');
  const list = document.getElementById('timelineStepperList');
  const driveBtn = document.getElementById('timelineDriveLink');

  list.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดไทม์ไลน์...</div>';
  modal.classList.add('active');

  try {
    const res = await fetch(`/api/plans/${planId}/timeline`);
    const json = await res.json();

    if (!json.success || !json.data) {
      list.innerHTML = '<div class="alert-card alert-danger">ไม่สามารถโหลดไทม์ไลน์ได้</div>';
      return;
    }

    let plan = json.data.plan || {};
    let timeline = json.data.timeline;
    if (!timeline && Array.isArray(json.data)) {
      timeline = json.data;
    }
    if (!timeline) timeline = [];

    badge.textContent = `${plan.subject_code || '-'} ${plan.teacher_name ? '(' + plan.teacher_name + ')' : ''}`;

    // Banner message indicating current reviewer
    if (plan.submission_status === 'approved') {
      banner.innerHTML = '🎉 อนุมัติเสร็จสมบูรณ์เรียบร้อยแล้ว';
    } else if (plan.submission_status === 'revision_needed') {
      banner.innerHTML = '⚠️ ถูกส่งกลับแก้ไข — รอครูผู้สอนปรับปรุงข้อมูล';
    } else {
      banner.innerHTML = `⏳ ตอนนี้ถึง: <strong>${escapeHtml(plan.current_reviewer_title || 'หัวหน้ากลุ่มสาระการเรียนรู้')}</strong> กำลังตรวจสอบ`;
    }

    // Google Drive Link
    if (plan.google_drive_view_link) {
      driveBtn.href = plan.google_drive_view_link;
      driveBtn.style.display = 'inline-flex';
    } else {
      driveBtn.style.display = 'none';
    }

    // Role-specific avatar icons for 5 approval tiers
    const roleAvatars = {
      dept_head: '👩‍💼',
      curriculum_head: '📋',
      academic_head: '📚',
      academic_director: '👨‍💼',
      director: '🏛️'
    };

    // Render Timeline Steps
    let stepsHtml = '';
    timeline.forEach(step => {
      let icon = '<i class="fa-solid fa-hourglass-start"></i>';
      let statusLabel = 'รอตามลำดับ';
      let badgeClass = 'badge-draft';
      const roleAvatar = roleAvatars[step.stage_key] || '👤';

      if (step.status === 'completed') {
        icon = '<i class="fa-solid fa-check"></i>';
        statusLabel = 'ผ่านการตรวจแล้ว';
        badgeClass = 'badge-approved';
      } else if (step.status === 'in_progress') {
        icon = '<i class="fa-solid fa-spinner fa-spin"></i>';
        statusLabel = '⏳ กำลังอยู่ระหว่างตรวจ';
        badgeClass = 'badge-submitted';
      } else if (step.status === 'revision_needed') {
        icon = '<i class="fa-solid fa-triangle-exclamation"></i>';
        statusLabel = '⚠️ ส่งกลับแก้ไข';
        badgeClass = 'badge-revision_needed';
      }

      stepsHtml += `
        <div class="timeline-step ${step.status}">
          <div class="timeline-line"></div>
          <div class="timeline-node">${icon}</div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-title">${roleAvatar} ${escapeHtml(step.stage_title)}</span>
              <span class="badge ${badgeClass}">${statusLabel}</span>
            </div>
            <div class="timeline-desc">
              ${step.reviewer_name ? `<strong>ผู้ดำเนินการ:</strong> ${escapeHtml(step.reviewer_name)}` : '<em>รอผู้ตรวจประจำขั้นดำเนินการ</em>'}
              ${step.action_at ? `<span class="timeline-time" style="margin-left: 8px;">(${formatDate(step.action_at)})</span>` : ''}
            </div>
            ${step.feedback ? `
              <div class="timeline-feedback-box">
                <i class="fa-solid fa-comment-dots" style="margin-right: 4px;"></i>
                <strong>ความเห็น:</strong> ${escapeHtml(step.feedback)}
              </div>
            ` : ''}
            ${step.reviewer_signature ? `
              <div style="margin-top: 6px;">
                <span style="font-size: 0.72rem; color: #64748b;">ลายเซ็นผู้ตรวจ:</span><br>
                <img src="${step.reviewer_signature}" alt="ลายมือชื่อผู้ตรวจ" style="height: 38px; border: 1px dashed #cbd5e1; border-radius: 4px; padding: 2px 6px; background: #fff;" />
              </div>
            ` : ''}
          </div>
        </div>
      `;
    });

    currentTimelinePlanData = json.data;
    const initialRound = (plan.current_round === 2 || plan.submission_status === 'approved') && plan.round_2_status && plan.round_2_status !== 'not_started' ? 2 : 1;
    switchTimelineRound(initialRound);

  } catch (err) {
    list.innerHTML = `<div class="alert-card alert-danger">เกิดข้อผิดพลาด: ${err.message}</div>`;
  }
}

function closeTimelineModal() {
  document.getElementById('timelineModal').classList.remove('active');
}

// -------------------------------------------------------------
// 7. Teacher Search History View with EXACT 5-TIER UI STEPPER
// 1. หน.กลุ่มสาระ -> 2. หน.งานหลักสูตร -> 3. หน.บริหารวิชาการ -> 4. รอง ผอ. ฝ่ายวิชาการ -> 5. ผู้อำนวยการ
// -------------------------------------------------------------
function buildInlineTimelineHtml(timeline, currentStage, currentTitle, submissionStatus) {
  if (!timeline || timeline.length === 0) {
    return '<div style="font-size: 0.85rem; color: #94a3b8; padding: 8px;">ยังไม่มีข้อมูลไทม์ไลน์</div>';
  }

  // Friendly short names for the 5 levels of approval
  const stepTitles = [
    '1. หน.กลุ่มสาระฯ',
    '2. หน.งานหลักสูตร',
    '3. หน.บริหารวิชาการ',
    '4. รอง ผอ. ฝ่ายวิชาการ',
    '5. ผู้อำนวยการ'
  ];

  let html = `
    <div class="user-flow-stepper-card">
      <div class="stepper-track-wrap">
  `;

  timeline.forEach((step, idx) => {
    const stepNum = idx + 1;
    const isCompleted = step.status === 'completed';
    const isInProgress = step.status === 'in_progress';
    const isRevision = step.status === 'revision_needed';

    let itemClass = '';
    let circleContent = stepNum;
    let chevronHtml = '';
    let subText = '';

    if (isCompleted) {
      itemClass = 'completed';
      circleContent = '<i class="fa-solid fa-check"></i>';
      subText = step.reviewer_name ? `${escapeHtml(step.reviewer_name.split(' ')[0])} (ผ่าน)` : 'ผ่านแล้ว';
    } else if (isInProgress) {
      itemClass = 'active';
      chevronHtml = '<div class="stepper-chevron-indicator"><i class="fa-solid fa-chevron-down"></i></div>';
      circleContent = stepNum;
      subText = '⏳ กำลังตรวจ';
    } else if (isRevision) {
      itemClass = 'revision';
      chevronHtml = '<div class="stepper-chevron-indicator"><i class="fa-solid fa-chevron-down"></i></div>';
      circleContent = '!';
      subText = '⚠️ ให้แก้ไข';
    } else {
      itemClass = 'waiting';
      circleContent = stepNum;
      subText = 'รอตามลำดับ';
    }

    // Step item
    html += `
      <div class="stepper-item ${itemClass}">
        <div class="stepper-node-box">
          ${chevronHtml}
          <div class="stepper-circle">${circleContent}</div>
        </div>
        <div class="stepper-content-box">
          <div class="stepper-label">${stepTitles[idx] || escapeHtml(step.stage_title)}</div>
          <div class="stepper-sub">${subText}</div>
          ${step.feedback ? `<div class="stepper-feedback-badge" title="${escapeHtml(step.feedback)}">"${escapeHtml(step.feedback.length > 20 ? step.feedback.substring(0, 18) + '...' : step.feedback)}"</div>` : ''}
        </div>
      </div>
    `;

    // Connector between steps (green if current step is completed)
    if (idx < timeline.length - 1) {
      const isNextActiveOrCompleted = isCompleted;
      const connectorClass = isNextActiveOrCompleted ? 'completed' : '';
      html += `<div class="stepper-connector ${connectorClass}"></div>`;
    }
  });

  html += `
      </div>
    </div>
  `;
  return html;
}

async function searchTeacherHistory(isManualClick = true) {
  const emailInput = document.getElementById('trackSearchEmail');
  const resultsArea = document.getElementById('trackResultsArea');
  const email = emailInput ? emailInput.value.trim() : '';

  if (!email) {
    if (isManualClick) {
      Swal.fire({
        icon: 'info',
        title: 'กรุณาระบุอีเมล',
        text: 'พิมพ์อีเมลของครูผู้สอนเพื่อค้นหาประวัติการส่งแผนการสอน',
        confirmButtonColor: '#2563eb',
        confirmButtonText: 'ตกลง'
      });
    }
    return;
  }

  resultsArea.innerHTML = '<div style="text-align: center; padding: 2rem; color: #64748b;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดข้อมูลและไทม์ไลน์...</div>';

  try {
    const res = await fetch(`/api/plans/teacher/${encodeURIComponent(email)}`);
    const json = await res.json();

    if (!json.success || !json.data || json.data.length === 0) {
      resultsArea.innerHTML = `
        <div class="preview-placeholder" style="padding: 3rem 1rem;">
          <i class="fa-regular fa-folder"></i>
          <p style="font-weight: 600;">ไม่พบประวัติการส่งแผนการสอน</p>
          <p style="font-size: 0.85rem;">ไม่พบข้อมูลการส่งแผนสำหรับอีเมล <strong>${escapeHtml(email)}</strong></p>
        </div>
      `;
      return;
    }

    let html = `
      <div style="margin-bottom: 1.25rem; font-weight: 600; color: #1e3a8a; display: flex; justify-content: space-between; align-items: center;">
        <span>พบประวัติการส่งทั้งหมด ${json.data.length} รายการ (แสดงไทม์ไลน์ลำดับขั้นการตรวจทันที)</span>
        <span style="font-size: 0.82rem; color: #64748b;"><i class="fa-solid fa-bolt"></i> อัปเดตแบบเรียลไทม์</span>
      </div>
    `;

    json.data.forEach(p => {
      const driveLink = p.google_drive_view_link 
        ? `<a href="${p.google_drive_view_link}" target="_blank" class="btn-gdrive" title="เปิดดูบน Google Drive"><i class="fa-brands fa-google-drive"></i> เปิดไฟล์บน Google Drive</a>`
        : '';

      const canEdit = p.submission_status === 'draft' || p.submission_status === 'revision_needed';
      const editBtn = canEdit 
        ? `<button class="btn btn-sm btn-primary" style="border-radius: var(--radius-full); padding: 6px 16px; font-size: 0.82rem;" onclick="loadPlanIntoEditMode('${p.id}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข / ส่งฉบับปรับปรุง</button>`
        : '';

      // Live Reviewer Status Indicator
      let livePill = '';
      if (p.submission_status === 'approved') {
        livePill = `<div class="live-reviewer-pill approved"><i class="fa-solid fa-circle-check"></i> อนุมัติเสร็จสมบูรณ์เรียบร้อยแล้ว</div>`;
      } else if (p.submission_status === 'revision_needed') {
        livePill = `<div class="live-reviewer-pill revision"><i class="fa-solid fa-triangle-exclamation"></i> ส่งกลับแก้ไข (${escapeHtml(p.current_reviewer_title || 'ผู้ตรวจ')})</div>`;
      } else {
        livePill = `
          <div class="live-reviewer-pill">
            <span class="pulse-dot"></span>
            ตอนนี้ถึง: <strong>${escapeHtml(p.current_reviewer_title || 'หัวหน้ากลุ่มสาระการเรียนรู้')}</strong> กำลังตรวจ
          </div>
        `;
      }

      // Inline Timeline 4-step Grid (Always visible!)
      const timelineHtml = buildInlineTimelineHtml(p.timeline, p.current_stage, p.current_reviewer_title);

      html += `
        <div class="plan-card-item status-${p.submission_status || 'submitted'}">
          <!-- Card Header -->
          <div class="plan-card-header">
            <div>
              <div class="plan-info-title">
                <code>${escapeHtml(p.subject_code)}</code> - ${escapeHtml(p.subject_name)}
              </div>
              <div class="plan-info-meta">
                <span><i class="fa-solid fa-calendar"></i> ${escapeHtml(p.term_name || p.term_code)}</span>
                <span><i class="fa-solid fa-layer-group"></i> ${escapeHtml(p.grade_level || 'ทุกระดับชั้น')}</span>
                <span><i class="fa-solid fa-school"></i> ${escapeHtml(p.teacher_department)}</span>
                <span><i class="fa-solid fa-clock"></i> ส่งเมื่อ: ${formatDate(p.created_at)}</span>
              </div>
            </div>
            <div>
              ${livePill}
            </div>
          </div>

          <!-- DIRECT INLINE TIMELINE STEPPER (ขึ้นของแต่ละคนทันที ไม่ต้องคลิก) -->
          ${timelineHtml}

          <!-- Dual-Round Badges -->
          <div style="display: flex; gap: 8px; align-items: center; margin: 10px 0 6px 0; flex-wrap: wrap;">
            <span class="badge-round badge-round-1"><i class="fa-solid fa-1"></i> ครั้งที่ 1: ${getStatusLabel(p.submission_status)}</span>
            ${(p.round_2_status && p.round_2_status !== 'not_started') 
              ? `<span class="badge-round badge-round-2"><i class="fa-solid fa-2"></i> ครั้งที่ 2: ${getStatusLabel(p.round_2_status)}</span>` 
              : `<span class="badge-round" style="background: #f1f5f9; color: #64748b; border: 1px dashed #cbd5e1;"><i class="fa-solid fa-2"></i> ครั้งที่ 2: ยังไม่ได้ส่ง</span>`
            }
          </div>

          <!-- Action Toolbar -->
          <div class="plan-card-actions">
            <a href="${(window.API_BASE_URL || '/api')}/files/download/${p.id}" target="_blank" class="btn btn-sm btn-outline" style="border-radius: var(--radius-full); padding: 6px 14px; font-size: 0.82rem; white-space: nowrap;" title="ดาวน์โหลดฉบับประทับตรา">
              <i class="fa-solid fa-download"></i> ดาวน์โหลด PDF ประทับตรา
            </a>
            ${driveLink}
            ${editBtn}
            ${(!p.round_2_status || p.round_2_status === 'not_started' || p.round_2_status === 'revision_needed') ? `
              <button type="button" class="btn-quick-round2" onclick="openRound2Modal('${p.id}', '${escapeHtml(p.subject_code)}', '${escapeHtml(p.subject_name)}')">
                <i class="fa-solid fa-signature"></i> ✍️ ส่ง/ลงนามครั้งที่ 2
              </button>
            ` : ''}
          </div>
        </div>
      `;
    });

    resultsArea.innerHTML = html;

  } catch (err) {
    resultsArea.innerHTML = `<div class="alert-card alert-danger">เกิดข้อผิดพลาดในการโหลดข้อมูล: ${err.message}</div>`;
  }
}

// -------------------------------------------------------------
// 8. Academic Reviewer Dashboard (ฝ่ายวิชาการ & ไทม์ไลน์สด)
// -------------------------------------------------------------
let currentAdminFilterMode = 'my_turn';

function setAdminFilterMode(mode) {
  currentAdminFilterMode = mode;

  // Update tab buttons active state
  const tabButtons = document.querySelectorAll('.reviewer-tab-btn');
  tabButtons.forEach(btn => {
    btn.classList.remove('active');
  });

  if (mode === 'my_turn') {
    const btn = document.getElementById('btnFilterMyTurn');
    if (btn) btn.classList.add('active');
  } else if (mode === 'approved') {
    const btn = document.getElementById('btnFilterApproved');
    if (btn) btn.classList.add('active');
  } else if (mode === 'waiting_others') {
    const btn = document.getElementById('btnFilterWaiting');
    if (btn) btn.classList.add('active');
  } else if (mode === 'revision') {
    const btn = document.getElementById('btnFilterRevision');
    if (btn) btn.classList.add('active');
  } else if (mode === 'all') {
    const btn = document.getElementById('btnFilterAll');
    if (btn) btn.classList.add('active');
  }

  // Guidance notice for approved mode (เลือกดูตามหมวดวิชาได้)
  const approvedNotice = document.getElementById('approvedDeptNotice');
  const deptSelect = document.getElementById('adminFilterDept');
  if (approvedNotice) {
    if (mode === 'approved') {
      approvedNotice.style.display = 'flex';
      if (deptSelect && (!currentUser || currentUser.role !== 'dept_head')) {
        deptSelect.style.borderColor = '#059669';
        deptSelect.style.boxShadow = '0 0 0 3px rgba(5, 150, 105, 0.15)';
      }
    } else {
      approvedNotice.style.display = 'none';
      if (deptSelect) {
        deptSelect.style.borderColor = '';
        deptSelect.style.boxShadow = '';
      }
    }
  }

  // Update table description header
  const header = document.getElementById('adminTableStatusHeader');
  if (header) {
    if (mode === 'my_turn') {
      header.innerHTML = '<i class="fa-solid fa-bolt" style="color: #d97706;"></i> แสดงเฉพาะแผนที่ <strong>ถึงคิวฉันตรวจ (รอฉันลงนาม)</strong>';
    } else if (mode === 'approved') {
      header.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #059669;"></i> แสดง <strong>แผนที่อนุมัติแล้วทั้งหมด</strong> (เลือกดูแยกตามหมวดวิชาได้)';
    } else if (mode === 'waiting_others') {
      header.innerHTML = '<i class="fa-solid fa-hourglass-half" style="color: #64748b;"></i> แสดงแผนที่ <strong>รอขั้นตอนอื่นในสายตรวจ</strong>';
    } else if (mode === 'revision') {
      header.innerHTML = '<i class="fa-solid fa-rotate-left" style="color: #dc2626;"></i> แสดงแผนที่ <strong>ส่งกลับให้แก้ไข</strong>';
    } else {
      header.innerHTML = '<i class="fa-solid fa-folder-open" style="color: #2563eb;"></i> แสดง <strong>แผนทั้งหมดในระบบ</strong>';
    }
  }

  loadAdminPlans();
}

function debounceAdminSearch() {
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(loadAdminPlans, 350);
}

async function loadAdminPlans() {
  const termSelect = document.getElementById('adminFilterTerm');
  const termId = termSelect ? termSelect.value : '';
  const deptSelect = document.getElementById('adminFilterDept');
  let dept = deptSelect ? deptSelect.value : '';
  const searchInput = document.getElementById('adminFilterSearch');
  const search = searchInput ? searchInput.value.trim() : '';

  // Enforce Department Scoping: if current user is dept_head, lock to their department
  if (currentUser && currentUser.role === 'dept_head' && currentUser.department) {
    dept = currentUser.department;
    if (deptSelect) {
      deptSelect.value = currentUser.department;
      deptSelect.disabled = true;
      deptSelect.title = `สิทธิ์ของท่านตรวจได้เฉพาะกลุ่มสาระฯ ${currentUser.department}`;
    }
  } else if (deptSelect) {
    deptSelect.disabled = false;
  }

  const tbody = document.getElementById('adminTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #94a3b8; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดข้อมูลและจัดลำดับสายตรวจ...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (termId) params.append('term_id', termId);
    if (dept) params.append('department', dept);
    if (search) params.append('search', search);
    params.append('filter_mode', currentAdminFilterMode);

    if (currentUser) {
      params.append('reviewer_role', currentUser.role);
      if (currentUser.department) params.append('reviewer_dept', currentUser.department);
    }

    const res = await fetch(`/api/admin/plans?${params.toString()}`);
    const json = await res.json();

    // Update Counts & Badges dynamically for this role
    if (json.counts) {
      const elP = document.getElementById('reviewerPendingCount'); if (elP) elP.textContent = json.counts.my_turn || 0;
      const elA = document.getElementById('reviewerApprovedCount'); if (elA) elA.textContent = json.counts.approved || 0;
      const elR = document.getElementById('reviewerRevisionCount'); if (elR) elR.textContent = json.counts.revision || 0;
      const elT = document.getElementById('reviewerTotalCount'); if (elT) elT.textContent = json.counts.total || 0;

      const badgeMyTurn = document.getElementById('tabBadgeMyTurn'); if (badgeMyTurn) badgeMyTurn.textContent = json.counts.my_turn || 0;
      const badgeApproved = document.getElementById('tabBadgeApproved'); if (badgeApproved) badgeApproved.textContent = json.counts.approved || 0;
      const badgeWaiting = document.getElementById('tabBadgeWaiting'); if (badgeWaiting) badgeWaiting.textContent = json.counts.waiting_others || 0;
      const badgeRevision = document.getElementById('tabBadgeRevision'); if (badgeRevision) badgeRevision.textContent = json.counts.revision || 0;
      const badgeTotal = document.getElementById('tabBadgeTotal'); if (badgeTotal) badgeTotal.textContent = json.counts.total || 0;
    }

    if (!json.success || !json.data || json.data.length === 0) {
      let emptyMsg = 'ไม่พบรายการแผนการสอนตามเงื่อนไขที่เลือก';
      if (currentAdminFilterMode === 'my_turn') {
        emptyMsg = '🎉 ยอดเยี่ยม! ไม่มีแผนการสอนค้างตรวจในขั้นตอนของท่านในขณะนี้';
      } else if (currentAdminFilterMode === 'approved') {
        emptyMsg = 'ยังไม่มีแผนการสอนที่ได้รับอนุมัติเสร็จสมบูรณ์ในหมวดวิชานี้';
      } else if (currentAdminFilterMode === 'waiting_others') {
        emptyMsg = 'ไม่มีแผนการสอนที่กำลังรอขั้นตอนอื่น';
      } else if (currentAdminFilterMode === 'revision') {
        emptyMsg = 'ไม่มีแผนการสอนที่อยู่ในสถานะส่งกลับแก้ไข';
      }
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 2.5rem; font-size: 0.95rem;">${emptyMsg}</td></tr>`;
      return;
    }

    window.adminPlansCache = json.data;

    const stageTitleMap = {
      dept_head: 'หัวหน้ากลุ่มสาระการเรียนรู้',
      curriculum_head: 'หัวหน้างานหลักสูตร',
      academic_director: 'รองผู้อำนวยการฝ่ายวิชาการ',
      director: 'ผู้อำนวยการโรงเรียน',
      completed: 'อนุมัติเรียบร้อย'
    };

    let rows = '';
    json.data.forEach(p => {
      const driveHtml = p.google_drive_view_link 
        ? `<a href="${p.google_drive_view_link}" target="_blank" class="btn-gdrive" title="เปิดดูไฟล์บน Google Drive"><i class="fa-brands fa-google-drive"></i> ดูบนไดรฟ์</a>`
        : '<span style="color: #94a3b8;">-</span>';

      const hasRound2 = (p.current_round === 2 || (p.round_2_status && p.round_2_status !== 'not_started'));
      const r1Approved = p.submission_status === 'approved';
      const r2Approved = p.round_2_status === 'approved';
      const r1Revision = p.submission_status === 'revision_needed';
      const r2Revision = p.round_2_status === 'revision_needed';

      // Active round for reviewer focus:
      // If Round 1 is approved and Round 2 has started, focus is Round 2. Otherwise focus is Round 1.
      const activeRound = (r1Approved && hasRound2) ? 2 : 1;
      const activeStatus = activeRound === 2 ? (p.round_2_status || 'submitted') : (p.submission_status || 'submitted');
      const activeStage = activeRound === 2 ? (p.round_2_stage || 'dept_head') : (p.current_stage || 'dept_head');
      const currentStageName = stageTitleMap[activeStage] || (activeRound === 2 ? 'หัวหน้ากลุ่มสาระการเรียนรู้' : (p.current_reviewer_title || 'หัวหน้ากลุ่มสาระการเรียนรู้'));

      // Check whether it is user's turn for Round 1 and Round 2
      const isUserTurnR1 = ['submitted', 'under_review'].includes(p.submission_status) && (
        p.current_stage === currentUser.role || 
        (currentUser.role === 'admin' && !r1Approved)
      );
      const isUserTurnR2 = hasRound2 && ['submitted', 'under_review'].includes(p.round_2_status) && (
        (p.round_2_stage || 'dept_head') === currentUser.role || 
        (currentUser.role === 'admin' && !r2Approved)
      );

      const isUserTurn = activeRound === 2 ? isUserTurnR2 : isUserTurnR1;

      // Mini inline timeline tracker for the table row
      let miniTimelineHtml = '<div style="display: flex; gap: 4px; align-items: center; margin-top: 6px;">';
      const activeTimeline = (activeRound === 2 && p.timeline_round_2 && p.timeline_round_2.length > 0)
        ? p.timeline_round_2
        : (p.timeline || p.timeline_round_1 || []);

      if (activeTimeline.length > 0) {
        activeTimeline.forEach((step, idx) => {
          let dotColor = '#cbd5e1';
          let titleText = `${step.stage_title}: รอตามลำดับ`;
          if (step.status === 'completed') {
            dotColor = '#10b981';
            titleText = `${step.stage_title}: ผ่านแล้ว (${step.reviewer_name || ''})`;
          } else if (step.status === 'in_progress') {
            dotColor = '#2563eb';
            titleText = `${step.stage_title}: ⏳ กำลังตรวจอยู่`;
          } else if (step.status === 'revision_needed') {
            dotColor = '#ef4444';
            titleText = `${step.stage_title}: ⚠️ ส่งกลับแก้ไข`;
          }

          miniTimelineHtml += `
            <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${dotColor};" title="${escapeHtml(titleText)}"></span>
            ${idx < activeTimeline.length - 1 ? '<span style="display: inline-block; width: 8px; height: 2px; background: #e2e8f0;"></span>' : ''}
          `;
        });
      }
      miniTimelineHtml += '</div>';

      // Action Button & Badge Logic:
      let actionButtonHtml = '';
      if (r1Approved && r2Approved) {
        actionButtonHtml = `<span class="badge badge-approved" style="font-size: 0.8rem; padding: 6px 12px;"><i class="fa-solid fa-circle-check"></i> อนุมัติครบ 2 ครั้ง</span>`;
      } else if (r1Approved && !hasRound2) {
        actionButtonHtml = `<span class="badge badge-approved" style="font-size: 0.8rem; padding: 6px 12px;"><i class="fa-solid fa-circle-check"></i> ผ่านครั้งที่ 1 (รอส่งครั้งที่ 2)</span>`;
      } else if (activeStatus === 'revision_needed') {
        const roundSuffix = activeRound === 2 ? ' (ครั้งที่ 2)' : ' (ครั้งที่ 1)';
        actionButtonHtml = `<span class="badge badge-revision_needed" style="font-size: 0.8rem; padding: 6px 12px;"><i class="fa-solid fa-rotate-left"></i> ส่งกลับแล้ว${roundSuffix}</span>`;
      } else if (isUserTurn) {
        const roundLabel = activeRound === 2 ? 'ครั้งที่ 2' : 'ครั้งที่ 1';
        actionButtonHtml = `
          <button type="button" class="btn-table-review active-turn" onclick="openStepReviewModal('${p.id}', ${activeRound})" title="คลิกเพื่อตรวจและลงนาม (${roundLabel})">
            <i class="fa-solid fa-signature"></i> ✍️ ตรวจและลงนาม (${roundLabel})
          </button>
        `;
      } else {
        const stageShort = currentStageName
          .replace('กลุ่มสาระการเรียนรู้', 'หมวด')
          .replace('รองผู้อำนวยการฝ่ายวิชาการ', 'ฝ่ายวิชาการ')
          .replace('รองผู้อำนวยการกลุ่มบริหารวิชาการ', 'ฝ่ายวิชาการ');
        const roundSub = activeRound === 2 ? ' (ครั้งที่ 2)' : ' (ครั้งที่ 1)';
        actionButtonHtml = `
          <span class="badge badge-waiting-stage" title="ขณะนี้อยู่ในขั้นตอนของ ${escapeHtml(currentStageName)}${roundSub}">
            <i class="fa-solid fa-clock"></i> รอ${escapeHtml(stageShort)}${roundSub}
          </span>
        `;
      }

      rows += `
        <tr>
          <td style="font-size: 0.8rem; color: #64748b;">${formatDate(p.created_at)}</td>
          <td>
            <strong>${escapeHtml(p.teacher_name)}</strong><br>
            <span style="font-size: 0.78rem; color: #64748b;">${escapeHtml(p.teacher_email)}</span>
          </td>
          <td>
            <span class="dept-badge-pill">${escapeHtml(p.teacher_department)}</span>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <code>${escapeHtml(p.subject_code)}</code>
              ${hasRound2 
                ? '<span class="badge-round badge-round-2" style="font-size: 0.72rem;"><i class="fa-solid fa-2"></i> ครั้งที่ 2</span>'
                : '<span class="badge-round badge-round-1" style="font-size: 0.72rem;"><i class="fa-solid fa-1"></i> ครั้งที่ 1</span>'
              }
            </div>
            <span style="font-size: 0.8rem; color: #475569;">${escapeHtml(p.subject_name)}</span>
          </td>
          <td>
            <div style="font-weight: 600; font-size: 0.82rem; color: #1e40af;">
              <i class="fa-solid fa-user-clock"></i> ${activeRound === 2 ? 'ครั้งที่ 2 ถึง: ' : 'ครั้งที่ 1 ถึง: '}${escapeHtml(currentStageName)}
            </div>
            ${miniTimelineHtml}
          </td>
          <td class="col-gdrive">${driveHtml}</td>
          <td class="col-actions">
            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" class="btn-action-icon timeline-btn" onclick="openTimelineModal('${p.id}')" title="เปิดไทม์ไลน์ฉบับเต็ม">
                <i class="fa-solid fa-timeline"></i>
              </button>
              <a href="${(window.API_BASE_URL || '/api')}/files/view-stamped/${p.id}" target="_blank" class="btn-action-icon pdf-btn" title="ตรวจไฟล์ประทับตรา">
                <i class="fa-solid fa-file-pdf"></i>
              </a>
              ${actionButtonHtml}
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rows;

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color: #dc2626; text-align: center;">เกิดข้อผิดพลาด: ${err.message}</td></tr>`;
  }
}

// -------------------------------------------------------------
// 9. Reviewer Workstation (PDF Preview + E-Signature + Actions)
// -------------------------------------------------------------
let reviewerSignaturePad = null;

function initReviewerSignaturePad() {
  const canvas = document.getElementById('reviewerSignatureCanvas');
  const wrapper = document.getElementById('reviewerCanvasWrapper');
  if (!canvas || !wrapper) return;

  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = wrapper.clientWidth * ratio;
  canvas.height = wrapper.clientHeight * ratio;
  canvas.getContext('2d').scale(ratio, ratio);

  if (typeof SignaturePad !== 'undefined') {
    reviewerSignaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255, 255, 255, 0)',
      penColor: '#0f172a',
      minWidth: 1.5,
      maxWidth: 3
    });
  } else {
    reviewerSignaturePad = createFallbackSignaturePad(canvas);
  }
}

function clearReviewerSignature() {
  if (reviewerSignaturePad) {
    reviewerSignaturePad.clear();
  }
}

function openReviewPdfNewTab() {
  const planId = document.getElementById('reviewPlanId').value;
  if (planId) {
    window.open(`${(window.API_BASE_URL || '/api')}/files/view-stamped/${planId}`, '_blank');
  }
}

function selectReviewRound(roundNum) {
  const r = parseInt(roundNum, 10) === 2 ? 2 : 1;
  const hiddenInput = document.getElementById('selectedReviewRound');
  if (hiddenInput) hiddenInput.value = r;

  const btn1 = document.getElementById('btnReviewRound1');
  const btn2 = document.getElementById('btnReviewRound2');
  const badge = document.getElementById('modalRoundBadge');
  const desc = document.getElementById('roundActiveDesc');

  if (btn1 && btn2) {
    if (r === 1) {
      btn1.classList.add('active');
      btn2.classList.remove('active', 'round-2');
      if (badge) {
        badge.className = 'badge-round badge-round-1';
        badge.textContent = 'รอบที่ 1';
      }
      if (desc) {
        desc.innerHTML = '<i class="fa-solid fa-circle-info"></i> กำลังตรวจและลงนามในช่อง: <strong>ครั้งที่ 1 (คอลัมน์ซ้าย)</strong>';
        desc.style.color = '#2563eb';
      }
    } else {
      btn1.classList.remove('active');
      btn2.classList.add('active', 'round-2');
      if (badge) {
        badge.className = 'badge-round badge-round-2';
        badge.textContent = 'รอบที่ 2';
      }
      if (desc) {
        desc.innerHTML = '<i class="fa-solid fa-circle-info"></i> กำลังตรวจและลงนามในช่อง: <strong>ครั้งที่ 2 (คอลัมน์ขวา)</strong>';
        desc.style.color = '#0d9488';
      }
    }
  }

  // Synchronize stage key and title for the chosen round
  const planId = document.getElementById('reviewPlanId') ? document.getElementById('reviewPlanId').value : null;
  const p = (window.adminPlansCache && planId) ? window.adminPlansCache.find(x => x.id === planId) : null;
  const stageEl = document.getElementById('reviewCurrentStage');
  const titleEl = document.getElementById('modalCurrentStageTitle');

  const stageTitleMap = {
    dept_head: 'หัวหน้ากลุ่มสาระการเรียนรู้',
    curriculum_head: 'หัวหน้างานหลักสูตร',
    academic_director: 'รองผู้อำนวยการฝ่ายวิชาการ',
    director: 'ผู้อำนวยการโรงเรียน',
    completed: 'อนุมัติเรียบร้อย'
  };

  let targetStage = 'dept_head';
  if (p) {
    targetStage = r === 2 ? (p.round_2_stage || 'dept_head') : (p.current_stage || 'dept_head');
    if (currentUser && currentUser.role && stageTitleMap[currentUser.role] && currentUser.role !== 'admin') {
      targetStage = currentUser.role;
    }
  } else if (currentUser && currentUser.role && stageTitleMap[currentUser.role] && currentUser.role !== 'admin') {
    targetStage = currentUser.role;
  }

  if (stageEl) stageEl.value = targetStage;
  if (titleEl) {
    const roundSuffix = r === 2 ? ' (ครั้งที่ 2)' : ' (ครั้งที่ 1)';
    titleEl.textContent = (stageTitleMap[targetStage] || targetStage) + roundSuffix;
  }
}

function openStepReviewModal(planId, teacherName, subjectCode, currentStage, currentTitle, defaultRound = 1) {
  let defRound = 1;
  let p = null;
  if (typeof teacherName === 'number') {
    defRound = teacherName;
  } else if (defaultRound) {
    defRound = defaultRound;
  }

  if (window.adminPlansCache) {
    p = window.adminPlansCache.find(x => x.id === planId);
  }

  const tName = p ? p.teacher_name : (typeof teacherName === 'string' ? teacherName : '');
  const sCode = p ? p.subject_code : (typeof subjectCode === 'string' ? subjectCode : '');

  document.getElementById('reviewPlanId').value = planId;
  document.getElementById('reviewPlanTitle').textContent = `${sCode} (${tName})`;

  selectReviewRound(defRound);

  // Load PDF into embedded iframe
  const iframe = document.getElementById('reviewPdfIframe');
  if (iframe) {
    iframe.src = `${(window.API_BASE_URL || '/api')}/files/view-stamped/${planId}?t=${Date.now()}`;
  }

  // Pre-fill reviewer name and role based on active logged in user
  const reviewerInput = document.getElementById('reviewerName');
  if (currentUser) {
    reviewerInput.value = `${currentUser.name} (${currentUser.position_title})`;
  } else {
    reviewerInput.value = currentTitle || 'ผู้ตรวจพิจารณา';
  }

  // Pre-fill default feedback as requested by user
  const feedback = document.getElementById('reviewFeedback');
  if (feedback) feedback.value = 'สามารถนำไปใช้ในการสอนได้';

  document.getElementById('reviewModal').classList.add('active');

  // Initialize and clear signature pad with delay for modal render
  setTimeout(() => {
    initReviewerSignaturePad();
    clearReviewerSignature();
  }, 150);
}

function closeReviewModal() {
  document.getElementById('reviewModal').classList.remove('active');
  const iframe = document.getElementById('reviewPdfIframe');
  if (iframe) iframe.src = '';
}

// Render Thai recommendation text onto high-res canvas PNG for stamping on PDF dotted lines
function renderFeedbackTextToPng(text, width = 205, height = 48) {
  const canvas = document.createElement('canvas');
  const scale = 3; // 3x ultra-sharp resolution for high-quality printing
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.font = '500 13px "Sarabun", "TH Sarabun New", "Tahoma", "Leelawadee UI", sans-serif';
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const startX = 6;
  const line1Y = 13;
  const line2Y = 35;

  const cleanText = (text || '').trim();
  if (cleanText.length <= 32) {
    ctx.fillText(cleanText, startX, line1Y);
  } else {
    // Split into 2 lines cleanly at word boundaries
    let splitIdx = 30;
    const spaceIdx = cleanText.lastIndexOf(' ', splitIdx);
    if (spaceIdx > 15) splitIdx = spaceIdx;
    const part1 = cleanText.substring(0, splitIdx).trim();
    const part2 = cleanText.substring(splitIdx).trim();
    ctx.fillText(part1, startX, line1Y);
    ctx.fillText(part2, startX, line2Y);
  }

  return canvas.toDataURL('image/png');
}

async function submitReviewAction(action) {
  const planId = document.getElementById('reviewPlanId').value;
  const currentStageEl = document.getElementById('reviewCurrentStage');
  const currentStage = currentStageEl ? currentStageEl.value : 'dept_head';
  let feedback = document.getElementById('reviewFeedback').value.trim();
  const reviewerName = document.getElementById('reviewerName').value.trim();
  const reviewerRole = currentUser ? currentUser.position_title : 'ผู้ตรวจพิจารณา';
  const roundEl = document.getElementById('selectedReviewRound');
  const targetRound = roundEl ? (parseInt(roundEl.value, 10) || 1) : 1;

  // If action is 'revision' (ตีกลับให้แก้ไข), ask for confirmation and optional reason
  if (action === 'revision') {
    let initialReason = feedback;
    if (initialReason === 'สามารถนำไปใช้ในการสอนได้') {
      initialReason = '';
    }

    const result = await Swal.fire({
      title: 'ยืนยันจะตีกลับให้แก้ไขหรือไม่?',
      html: `
        <div style="text-align: left; font-size: 0.9rem; color: #475569; margin-bottom: 12px; line-height: 1.5;">
          แผนการสอนนี้จะถูกส่งกลับไปยังครูผู้สอนเพื่อแก้ไขปรับปรุง และครูจะสามารถอัปโหลดไฟล์ฉบับแก้ไขส่งเข้ามาใหม่ได้
        </div>
        <div style="text-align: left; font-weight: 600; font-size: 0.88rem; color: #1e293b; margin-bottom: 6px;">
          ระบุเหตุผลหรือข้อเสนอแนะในการปรับปรุง (ถ้ามี):
        </div>
      `,
      input: 'textarea',
      inputValue: initialReason,
      inputPlaceholder: 'เช่น เพิ่มเติมจุดประสงค์การเรียนรู้, แนบใบงานประกอบ ฯลฯ (ไม่บังคับ)...',
      inputAttributes: {
        'rows': '3',
        'style': 'font-size: 0.9rem; font-family: inherit;'
      },
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b',
      confirmButtonText: '<i class="fa-solid fa-rotate-left"></i> ยืนยันตีกลับให้แก้ไข',
      cancelButtonText: 'ยกเลิก',
      reverseButtons: true,
      focusCancel: true
    });

    if (!result.isConfirmed) {
      return; // Reviewer cancelled the action
    }

    const enteredReason = result.value ? result.value.trim() : '';
    feedback = enteredReason || 'ส่งกลับเพื่อปรับปรุงแก้ไขเพิ่มเติม';

    // Update feedback field in modal as well
    const feedbackField = document.getElementById('reviewFeedback');
    if (feedbackField) feedbackField.value = feedback;
  } else if (action === 'approve') {
    if (!feedback) {
      feedback = 'สามารถนำไปใช้ในการสอนได้';
    }
  }

  // Get reviewer signature if drawn
  let reviewerSignature = null;
  if (reviewerSignaturePad && !reviewerSignaturePad.isEmpty()) {
    reviewerSignature = reviewerSignaturePad.toDataURL('image/png');
  }

  // Stamp reviewer signature onto PDF Page 1 at the specific tier slot
  let fileToUpload = null;
  if (action === 'approve' && reviewerSignature && window.PDFLib) {
    try {
      Swal.fire({
        title: 'กำลังประทับตราและบันทึกผล...',
        html: `กำลังประทับตราลายเซ็นลงในช่อง <strong>${escapeHtml(document.getElementById('modalCurrentStageTitle').textContent || 'ผู้ตรวจ')}</strong>...`,
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });

      const pdfResp = await fetch(`${(window.API_BASE_URL || '/api')}/files/download/${planId}`);
      if (pdfResp.ok) {
        const pdfBytes = await pdfResp.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const pages = pdfDoc.getPages();
        if (pages.length > 0) {
          const targetPage = pages[0];
          const isCol2 = targetRound === 2;
          const scaleX = targetPage.getWidth() / 723;
          const scaleY = targetPage.getHeight() / 1024;
          const toPdfX = (imgX) => imgX * scaleX;
          const toPdfY = (imgY) => targetPage.getHeight() - (imgY * scaleY);

          const stageSlots = {
            dept_head: { x: isCol2 ? 489 : 195, y: 582 },
            curriculum_head: { x: isCol2 ? 504 : 195, y: 626 },
            academic_head: { x: isCol2 ? 504 : 195, y: 626 },
            academic_director: { x: isCol2 ? 500 : 213, y: 760 },
            director: { x: isCol2 ? 505 : 213, y: 825 }
          };

          const slot = stageSlots[currentStage] || stageSlots['dept_head'];
          const parts = reviewerSignature.split(',');
          const b64 = parts.length > 1 ? parts[1] : parts[0];
          const binaryStr = atob(b64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

          const sigImg = await pdfDoc.embedPng(bytes);
          const sigSlotX = toPdfX(slot.x);
          const sigSlotY = toPdfY(slot.y);
          const renderW = 75 * scaleX;
          const renderH = 25 * scaleY;

          targetPage.drawImage(sigImg, {
            x: sigSlotX - (renderW / 2),
            y: sigSlotY - (renderH / 2) + 2,
            width: renderW,
            height: renderH
          });

          // If academic_director approved, also stamp their recommendation text onto the dotted lines
          if (currentStage === 'academic_director' && feedback) {
            try {
              const fbDataUrl = renderFeedbackTextToPng(feedback, 205, 48);
              const fbParts = fbDataUrl.split(',');
              const fbB64 = fbParts.length > 1 ? fbParts[1] : fbParts[0];
              const fbBin = atob(fbB64);
              const fbBytes = new Uint8Array(fbBin.length);
              for (let i = 0; i < fbBin.length; i++) fbBytes[i] = fbBin.charCodeAt(i);

              const fbImg = await pdfDoc.embedPng(fbBytes);
              const fbLeftImgX = isCol2 ? 399 : 110;
              const fbTopImgY = 712; // Top of the 48px box so line 1 sits at 725 and line 2 sits at 747

              const fbPdfX = toPdfX(fbLeftImgX);
              const fbPdfY = toPdfY(fbTopImgY + 48); // PDF-lib y is bottom-left of image
              const fbRenderW = 205 * scaleX;
              const fbRenderH = 48 * scaleY;

              targetPage.drawImage(fbImg, {
                x: fbPdfX,
                y: fbPdfY,
                width: fbRenderW,
                height: fbRenderH
              });
              console.log('✅ Academic Director recommendation text stamped on dotted lines successfully!');
            } catch (fbErr) {
              console.warn('Could not stamp academic_director recommendation text:', fbErr);
            }
          }

          const stampedPdfBytes = await pdfDoc.save();
          fileToUpload = new File([stampedPdfBytes], `stamped_${planId}.pdf`, { type: 'application/pdf' });
          console.log('✅ Reviewer signature stamped onto PDF Page 1! Stage:', currentStage);
        }
      }
    } catch (stampErr) {
      console.warn('Could not stamp reviewer signature into PDF:', stampErr);
    }
  }

  const formData = new FormData();
  formData.append('action', action);
  formData.append('feedback', feedback);
  formData.append('reviewer_name', reviewerName);
  formData.append('reviewer_role', reviewerRole);
  if (reviewerSignature) formData.append('reviewer_signature', reviewerSignature);
  formData.append('round', targetRound);
  formData.append('stageKey', currentStage);
  if (fileToUpload) {
    formData.append('pdf_file', fileToUpload);
  }

  try {
    const res = await fetch(`/api/admin/plans/${planId}/step-review`, {
      method: 'POST',
      body: formData
    });

    const json = await res.json();
    if (json.success) {
      const actionText = action === 'approve' ? 'อนุมัติ / เห็นชอบเรียบร้อย' : 'ตีกลับให้ครูแก้ไขเรียบร้อย';
      Swal.fire({
        icon: 'success',
        title: 'ดำเนินการสำเร็จ!',
        html: `<strong>${actionText}</strong><br><span style="font-size: 0.88rem; color: #64748b;">${json.message || ''}</span>`,
        confirmButtonColor: '#10b981',
        confirmButtonText: 'ตกลง'
      });
      closeReviewModal();
      loadAdminPlans();
      if (currentUser && currentUser.email && currentUser.role === 'teacher') {
        searchTeacherHistory(false);
      }
    } else {
      Swal.fire({
        icon: 'error',
        title: 'ไม่สามารถดำเนินการได้',
        text: json.message || 'เกิดข้อผิดพลาด',
        confirmButtonColor: '#ef4444'
      });
    }
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'บันทึกผลล้มเหลว',
      text: err.message,
      confirmButtonColor: '#ef4444'
    });
  }
}

// -------------------------------------------------------------
// 10. Tab Navigation & Helpers
// -------------------------------------------------------------
function switchTab(tabId) {
  ['submit', 'track', 'admin'].forEach(tab => {
    const btn = document.getElementById(`tabBtn${capitalize(tab)}`);
    const panel = document.getElementById(`panel${capitalize(tab)}`);
    if (btn && panel) {
      if (tab === tabId) {
        btn.classList.add('active');
        panel.classList.add('active');
      } else {
        btn.classList.remove('active');
        panel.classList.remove('active');
      }
    }
  });

  if (tabId === 'admin') {
    loadAdminPlans();
  }
}

function getStatusBadge(status) {
  const map = {
    submitted: '<span class="badge badge-submitted"><i class="fa-solid fa-clock"></i> รอตรวจสอบ</span>',
    under_review: '<span class="badge badge-under_review"><i class="fa-solid fa-hourglass-half"></i> อยู่ระหว่างตรวจ</span>',
    approved: '<span class="badge badge-approved"><i class="fa-solid fa-check-circle"></i> อนุมัติแล้ว</span>',
    revision_needed: '<span class="badge badge-revision_needed"><i class="fa-solid fa-triangle-exclamation"></i> ให้แก้ไข</span>',
    draft: '<span class="badge badge-draft"><i class="fa-solid fa-pen-ruler"></i> ฉบับร่าง</span>'
  };
  return map[status] || `<span class="badge badge-draft">${status}</span>`;
}

function getStatusLabel(status) {
  const map = {
    submitted: 'รอตรวจสอบ',
    under_review: 'อยู่ระหว่างตรวจสอบ',
    approved: 'อนุมัติแล้ว',
    revision_needed: 'ต้องแก้ไข',
    draft: 'ฉบับร่าง'
  };
  return map[status] || status;
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  return d.toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// -------------------------------------------------------------
// Global Modal Close Handlers (Click Backdrop or Press ESC)
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('active');
        const iframe = backdrop.querySelector('#reviewPdfIframe');
        if (iframe) iframe.src = '';
      }
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.active').forEach(backdrop => {
        backdrop.classList.remove('active');
        const iframe = backdrop.querySelector('#reviewPdfIframe');
        if (iframe) iframe.src = '';
      });
    }
  });
});


// -------------------------------------------------------------
// Round 2 Quick Submission Modal for Teachers
// -------------------------------------------------------------
let r2SignaturePad = null;

function initR2SignaturePad() {
  const canvas = document.getElementById('r2SignatureCanvas');
  const wrapper = document.getElementById('r2CanvasWrapper');
  if (!canvas || !wrapper) return;

  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = wrapper.clientWidth * ratio;
  canvas.height = wrapper.clientHeight * ratio;
  canvas.getContext('2d').scale(ratio, ratio);

  if (typeof SignaturePad !== 'undefined') {
    r2SignaturePad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255, 255, 255, 0)',
      penColor: '#0f172a',
      minWidth: 1.5,
      maxWidth: 3
    });
  } else {
    r2SignaturePad = createFallbackSignaturePad(canvas);
  }
}

function clearR2Signature() {
  if (r2SignaturePad) r2SignaturePad.clear();
}

function openRound2Modal(planId, subjectCode, subjectName) {
  const modal = document.getElementById('round2Modal');
  const titleEl = document.getElementById('r2ModalPlanTitle');
  const planIdInput = document.getElementById('r2PlanId');

  if (titleEl) titleEl.textContent = `${subjectCode} ${subjectName}`;
  if (planIdInput) planIdInput.value = planId;

  const fileInput = document.getElementById('r2PdfFile');
  if (fileInput) fileInput.value = '';

  modal.classList.add('active');

  setTimeout(() => {
    initR2SignaturePad();
    clearR2Signature();
  }, 150);
}

function closeRound2Modal() {
  const modal = document.getElementById('round2Modal');
  if (modal) modal.classList.remove('active');
}

async function submitRound2Quick() {
  const planId = document.getElementById('r2PlanId').value;
  if (!planId) return;

  if (!r2SignaturePad || r2SignaturePad.isEmpty()) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณาลงลายมือชื่อ',
      text: 'กรุณาลงลายมือชื่อครูผู้สอนสำหรับ ครั้งที่ 2 ก่อนยืนยัน',
      confirmButtonColor: '#0d9488'
    });
    return;
  }

  const signatureData = r2SignaturePad.toDataURL('image/png');
  const fileInput = document.getElementById('r2PdfFile');
  const file = fileInput && fileInput.files ? fileInput.files[0] : null;

  let fileToUpload = file;
  if (file && window.PDFLib) {
    try {
      const fileBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFLib.PDFDocument.load(fileBuffer, { ignoreEncryption: true });
      const pages = pdfDoc.getPages();
      if (pages.length > 0) {
        const targetPage = pages[0];
        const scaleX = targetPage.getWidth() / 723;
        const scaleY = targetPage.getHeight() / 1024;
        const toPdfX = (imgX) => imgX * scaleX;
        const toPdfY = (imgY) => targetPage.getHeight() - (imgY * scaleY);

        const parts = signatureData.split(',');
        const b64 = parts.length > 1 ? parts[1] : parts[0];
        const binaryStr = atob(b64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        const sigImage = await pdfDoc.embedPng(bytes);
        const sigSlotX = toPdfX(502);
        const sigSlotY = toPdfY(550);
        const renderW = 75 * scaleX;
        const renderH = 25 * scaleY;

        targetPage.drawImage(sigImage, {
          x: sigSlotX - (renderW / 2),
          y: sigSlotY - (renderH / 2) + 2,
          width: renderW,
          height: renderH
        });

        const stampedPdfBytes = await pdfDoc.save();
        fileToUpload = new File([stampedPdfBytes], file.name, { type: 'application/pdf' });
      }
    } catch (e) {
      console.warn('R2 stamp notice:', e);
    }
  }

  const formData = new FormData();
  formData.append('signature_data', signatureData);
  if (fileToUpload) formData.append('pdf_file', fileToUpload);

  Swal.fire({
    title: 'กำลังบันทึกและประทับตราครั้งที่ 2...',
    html: 'กำลังประทับตราลายเซ็นครูผู้สอนในช่อง <strong>ครั้งที่ 2 (คอลัมน์ขวา)</strong> และส่งต่อระบบ...',
    allowOutsideClick: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });

  try {
    const res = await fetch(`/api/plans/${planId}/submit-round-2`, {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    if (json.success) {
      Swal.fire({
        icon: 'success',
        title: 'ส่งครั้งที่ 2 เรียบร้อยแล้ว!',
        text: json.message,
        confirmButtonColor: '#0d9488'
      });
      closeRound2Modal();
      searchTeacherHistory(false);
      loadAdminPlans();
    } else {
      Swal.fire({
        icon: 'error',
        title: 'เกิดข้อผิดพลาด',
        text: json.message || 'ไม่สามารถส่งครั้งที่ 2 ได้',
        confirmButtonColor: '#ef4444'
      });
    }
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'ข้อผิดพลาดเครือข่าย',
      text: err.message,
      confirmButtonColor: '#ef4444'
    });
  }
}
