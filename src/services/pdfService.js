import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../database/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure stamped files directory exists
const stampedDir = path.resolve(__dirname, '../../data/stamped');
if (!fs.existsSync(stampedDir)) {
  fs.mkdirSync(stampedDir, { recursive: true });
}

// Template path for the official School Memo Form ("บันทึกข้อความ")
const templatePath = path.resolve(__dirname, '../../data/templates/memo_template.png');

// Thai Month Names helper
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

export class PdfService {
  /**
   * Get pixel-to-PDF coordinate mapping for the official memo form
   * Reference template image is 723 x 1024 px.
   */
  getSlotCoordinates(pageWidth, pageHeight, column = 1) {
    const scaleX = pageWidth / 595.32;
    const scaleY = pageHeight / 841.92;

    const toPdfX = (x) => x * scaleX;
    const toPdfY = (topY) => pageHeight - (topY * scaleY);

    const isCol2 = column === 2 || column === '2';

    return {
      // Slot 1: Teacher (ผู้สอน) -> Dotted line at topY = 449
      teacher: {
        centerX: toPdfX(isCol2 ? 410 : 170),
        centerY: toPdfY(449),
        width: 80 * scaleX,
        height: 22 * scaleY,
        dateX: toPdfX(isCol2 ? 415 : 175),
        dateY: toPdfY(424),
      },
      // Slot 2: Head of Department (หัวหน้ากลุ่มสาระฯ) -> Dotted line at topY = 479
      dept_head: {
        centerX: toPdfX(isCol2 ? 410 : 175),
        centerY: toPdfY(479),
        width: 80 * scaleX,
        height: 22 * scaleY,
      },
      // Slot 3: Curriculum / Academic Affairs Head (งานพัฒนาคุณภาพการจัดการเรียนการสอน)
      // Dotted line at topY = 514
      curriculum_head: {
        centerX: toPdfX(isCol2 ? 410 : 175),
        centerY: toPdfY(514),
        width: 80 * scaleX,
        height: 22 * scaleY,
      },
      academic_head: {
        centerX: toPdfX(isCol2 ? 410 : 175),
        centerY: toPdfY(514),
        width: 80 * scaleX,
        height: 22 * scaleY,
      },
      // Slot 4: Vice Director for Academic Affairs (รองผู้อำนวยการฝ่ายวิชาการ)
      // Comment lines at topY = 586 and 604, Dotted line at topY = 623
      academic_director: {
        centerX: toPdfX(isCol2 ? 410 : 175),
        centerY: toPdfY(623),
        width: 80 * scaleX,
        height: 22 * scaleY,
        commentX: toPdfX(isCol2 ? 410 : 175),
        commentY: toPdfY(586),
        commentY2: toPdfY(604),
      },
      // Slot 5: School Director (ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม)
      // Dotted line at topY = 677
      director: {
        centerX: toPdfX(isCol2 ? 410 : 175),
        centerY: toPdfY(677),
        width: 80 * scaleX,
        height: 22 * scaleY,
      }
    };
  }

  /**
   * Get pixel-to-PDF coordinate mapping for Page 2 (ตารางแสดงจุดเน้นการออกแบบการจัดกิจกรรมฯ นท.2)
   * Reference template size is 595.32 x 841.92 pt (A4 standard)
   */
  getPage2SlotCoordinates(pageWidth, pageHeight) {
    const scaleX = pageWidth / 595.32;
    const scaleY = pageHeight / 841.92;

    const toPdfX = (x) => x * scaleX;
    const toPdfY = (topY) => pageHeight - (topY * scaleY);

    return {
      // Slot 1: ครูผู้สอน -> แถวที่ 1 ด้านขวา ระหว่าง 'ลงชื่อ' กับ 'ผู้สอน' เหนือ (นายเอกเทศ เพ็ชรวิจิตร) ครู
      teacher: {
        centerX: toPdfX(430),
        centerY: toPdfY(609),
        width: 100 * scaleX,
        height: 25 * scaleY,
      },
      // Slot 2: หัวหน้ากลุ่มสาระการเรียนรู้ฯ -> แถวที่ 1 ด้านซ้าย เหนือ (นางวัชรี สุขสวัสดิ์)
      dept_head: {
        centerX: toPdfX(170),
        centerY: toPdfY(608),
        width: 100 * scaleX,
        height: 25 * scaleY,
      },
      // Slot 3: หัวหน้างานหลักสูตร / งานพัฒนาคุณภาพการจัดการเรียนการสอนการสอน -> แถวที่ 2 ด้านซ้าย เหนือ (...................)
      curriculum_head: {
        centerX: toPdfX(165),
        centerY: toPdfY(678),
        width: 100 * scaleX,
        height: 25 * scaleY,
      },
      academic_head: {
        centerX: toPdfX(165),
        centerY: toPdfY(678),
        width: 100 * scaleX,
        height: 25 * scaleY,
      },
      // Slot 4: รองผู้อำนวยการโรงเรียน กลุ่มบริหารวิชาการ -> แถวที่ 2 ด้านขวา เหนือ (นางสาวรัชนี ชูเมือง)
      academic_director: {
        centerX: toPdfX(430),
        centerY: toPdfY(676),
        width: 100 * scaleX,
        height: 25 * scaleY,
      },
      // Slot 5: ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม -> แถวล่างสุด ด้านขวา เหนือ (นางนิกูล ทองหน้าศาล)
      director: {
        centerX: toPdfX(440),
        centerY: toPdfY(757),
        width: 100 * scaleX,
        height: 25 * scaleY,
      }
    };
  }

  /**
   * Helper: Draw signature image onto designated slot with proper scaling
   */
  drawSignatureImage(page, slot, sigImage, fallbackText = null, thaiFont = null, helveticaBold = null) {
    if (!page || !slot) return false;
    if (sigImage) {
      const dims = sigImage.scale(0.35);
      const scale = Math.min(slot.width / dims.width, slot.height / dims.height, 1);
      const renderW = dims.width * scale;
      const renderH = dims.height * scale;

      page.drawImage(sigImage, {
        x: slot.centerX - (renderW / 2),
        y: slot.centerY - (renderH / 2) + 2,
        width: renderW,
        height: renderH,
      });
      return true;
    } else if (fallbackText) {
      try {
        if (thaiFont) {
          page.drawText(fallbackText, {
            x: slot.centerX - 35,
            y: slot.centerY + 2,
            size: 7,
            font: thaiFont,
            color: rgb(0.12, 0.35, 0.75),
          });
        } else if (helveticaBold) {
          page.drawText('[e-Signed]', {
            x: slot.centerX - 35,
            y: slot.centerY + 2,
            size: 7,
            font: helveticaBold,
            color: rgb(0.12, 0.35, 0.75),
          });
        }
      } catch (e) {
        // Safe skip text if encoding fails
      }
    }
    return false;
  }

  /**
   * Helper: Draw reviewer name masked inside parentheses (e.g. for curriculum_head on Page 2)
   */
  drawReviewerNameInParentheses(page, slot, reviewerName, thaiFont) {
    if (!page || !slot || !slot.nameY || !reviewerName || !thaiFont) return;
    try {
      const cleanName = reviewerName.replace(/[()]/g, '').trim();
      const fontSize = 8.0;
      const textW = thaiFont.widthOfTextAtSize(cleanName, fontSize);
      const nameCenterX = slot.nameX || slot.centerX;

      // Clean white mask over the dotted line inside the parentheses
      page.drawRectangle({
        x: nameCenterX - (textW / 2) - 4,
        y: slot.nameY - 2,
        width: textW + 8,
        height: 12,
        color: rgb(1, 1, 1),
      });

      page.drawText(cleanName, {
        x: nameCenterX - (textW / 2),
        y: slot.nameY,
        size: fontSize,
        font: thaiFont,
        color: rgb(0.08, 0.12, 0.22),
      });
    } catch (err) {
      console.warn('[PdfService] Error drawing name in parentheses on Page 2:', err.message);
    }
  }

  /**
   * Helper: Embed base64 PNG signature into PDF document
   */
  async embedSignature(pdfDoc, signatureBase64) {
    if (!signatureBase64 || !signatureBase64.includes('base64,')) {
      return null;
    }
    try {
      const base64Data = signatureBase64.split('base64,')[1];
      const imageBuffer = Buffer.from(base64Data, 'base64');
      return await pdfDoc.embedPng(imageBuffer);
    } catch (err) {
      console.warn('[PdfService] Error embedding PNG signature:', err.message);
      return null;
    }
  }

  /**
   * Helper: Embed a native Thai-supporting TTF font (e.g. Tahoma from Windows Fonts)
   */
  async getThaiFont(pdfDoc) {
    try {
      pdfDoc.registerFontkit(fontkit);
      const fontCandidates = [
        path.resolve(__dirname, '../../data/fonts/tahoma.ttf'),
        'C:/Windows/Fonts/tahoma.ttf',
        'C:/Windows/Fonts/cordia.ttf',
        'C:/Windows/Fonts/angsana.ttf',
        'C:/Windows/Fonts/arial.ttf',
        '/usr/share/fonts/truetype/thai/tahoma.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf'
      ];
      for (const fontPath of fontCandidates) {
        if (fs.existsSync(fontPath)) {
          const fontBytes = fs.readFileSync(fontPath);
          return await pdfDoc.embedFont(fontBytes);
        }
      }
    } catch (err) {
      console.warn('[PdfService] Error embedding Thai font:', err.message);
    }
    return null;
  }

  /**
   * Initial submission stamping:
   * Sets up the official memo cover page (or stamps onto Page 1)
   * Places Teacher's signature directly into Slot 1 (ผู้สอน)
   * And adds certification verification seal
   */
  async stampSignature({
    sourcePdfPath,
    signatureBase64,
    planId,
    teacherName,
    subjectCode,
    termName,
    signedAt = new Date(),
    column = 1
  }) {
    let pdfDoc;
    const isCol2 = column === 2 || column === '2';
    const certifiedPath = path.join(stampedDir, `${planId}_certified.pdf`);

    // If stamping Column 2 and certified file already exists, load existing file to preserve Column 1
    if (isCol2 && fs.existsSync(certifiedPath)) {
      const existingCertifiedBytes = fs.readFileSync(certifiedPath);
      pdfDoc = await PDFDocument.load(existingCertifiedBytes);
    } else {
      let hasSourceFile = sourcePdfPath && fs.existsSync(sourcePdfPath);
      if (hasSourceFile) {
        const existingPdfBytes = fs.readFileSync(sourcePdfPath);
        pdfDoc = await PDFDocument.load(existingPdfBytes);
      } else {
        pdfDoc = await PDFDocument.create();
      }
    }

    const a4Width = 595.28;
    const a4Height = 841.89;

    let memoPage;
    const pages = pdfDoc.getPages();

    if (pages.length > 0) {
      // Use existing first page (which already contains the formatted นท.1 memo form)
      memoPage = pages[0];
    } else if (fs.existsSync(templatePath)) {
      const templateBytes = fs.readFileSync(templatePath);
      const templateImage = await pdfDoc.embedPng(templateBytes);

      // Prepend a pristine A4 Memo Page at the front if the PDF has no pages
      memoPage = pdfDoc.insertPage(0, [a4Width, a4Height]);

      memoPage.drawImage(templateImage, {
        x: 0,
        y: 0,
        width: a4Width,
        height: a4Height,
      });
    } else {
      memoPage = pdfDoc.addPage([a4Width, a4Height]);
    }

    const { width, height } = memoPage.getSize();
    const slots = this.getSlotCoordinates(width, height, column);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const thaiFont = await this.getThaiFont(pdfDoc);

    // 1. Stamp Teacher Signature in Slot 1 (ผู้สอน)
    const teacherSigImage = await this.embedSignature(pdfDoc, signatureBase64);
    const teacherSlot = slots.teacher;

    if (teacherSigImage) {
      // Scale signature nicely to fit slot
      const dims = teacherSigImage.scale(0.35);
      const scale = Math.min(teacherSlot.width / dims.width, teacherSlot.height / dims.height, 1);
      const renderW = dims.width * scale;
      const renderH = dims.height * scale;

      memoPage.drawImage(teacherSigImage, {
        x: teacherSlot.centerX - (renderW / 2),
        y: teacherSlot.centerY - (renderH / 2) + 2,
        width: renderW,
        height: renderH,
      });
    } else {
      if (thaiFont) {
        memoPage.drawText(`[e-Signed: ${teacherName || 'ครูผู้สอน'}]`, {
          x: teacherSlot.centerX - 35,
          y: teacherSlot.centerY + 2,
          size: 7,
          font: thaiFont,
          color: rgb(0.12, 0.35, 0.75),
        });
      } else {
        memoPage.drawText(`[e-Signed: Digital Verified]`, {
          x: teacherSlot.centerX - 35,
          y: teacherSlot.centerY + 2,
          size: 7,
          font: helveticaBold,
          color: rgb(0.12, 0.35, 0.75),
        });
      }
    }

    // 1.1 Stamp Teacher Signature on Page 2 (ตารางจุดเน้นการจัดกิจกรรมฯ นท.2)
    const allDocPages = pdfDoc.getPages();
    if (allDocPages.length >= 2) {
      const page2 = allDocPages[1];
      const { width: p2W, height: p2H } = page2.getSize();
      const p2Slots = this.getPage2SlotCoordinates(p2W, p2H);
      this.drawSignatureImage(
        page2,
        p2Slots.teacher,
        teacherSigImage,
        teacherName ? `[e-Signed: ${teacherName}]` : null,
        thaiFont,
        helveticaBold
      );
    }

    // 2. Stamp Thai Date on Column 2 date dotted line
    const dateObj = new Date(signedAt);
    if (isCol2 && thaiFont) {
      try {
        const dayStr = String(dateObj.getDate());
        const monthStr = THAI_MONTHS[dateObj.getMonth()] || '';
        const yearStr = String(dateObj.getFullYear() + 543);
        const fontSize = 8.0;

        const scaleX = width / 595.32;
        const scaleY = height / 841.92;
        const toPdfX = (imgX) => imgX * scaleX;
        const toPdfY = (imgY) => height - (imgY * scaleY);

        const dayW = thaiFont.widthOfTextAtSize(dayStr, fontSize);
        memoPage.drawText(dayStr, {
          x: toPdfX(354) - (dayW / 2),
          y: toPdfY(424),
          size: fontSize,
          font: thaiFont,
          color: rgb(0.08, 0.12, 0.22)
        });

        const monthW = thaiFont.widthOfTextAtSize(monthStr, fontSize);
        memoPage.drawText(monthStr, {
          x: toPdfX(410) - (monthW / 2),
          y: toPdfY(424),
          size: fontSize,
          font: thaiFont,
          color: rgb(0.08, 0.12, 0.22)
        });

        const yearW = thaiFont.widthOfTextAtSize(yearStr, fontSize);
        memoPage.drawText(yearStr, {
          x: toPdfX(475) - (yearW / 2),
          y: toPdfY(424),
          size: fontSize,
          font: thaiFont,
          color: rgb(0.08, 0.12, 0.22)
        });
      } catch (dateErr) {
        console.warn('[PdfService] Error stamping date col 2:', dateErr.message);
      }
    }

    // 3. Draw certification seal badge on the last page of document
    const allPages = pdfDoc.getPages();
    const lastPage = allPages[allPages.length - 1];
    const lastPageSize = lastPage.getSize();

    const isPage2Last = allPages.length <= 2;
    const badgeW = isPage2Last ? 210 : 240;
    const badgeH = isPage2Last ? 68 : 95;
    const badgeX = isPage2Last ? 45 : (lastPageSize.width - badgeW - 25);
    const badgeY = isPage2Last ? 16 : 30;

    lastPage.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeW,
      height: badgeH,
      color: rgb(0.97, 0.98, 1.0),
      borderColor: rgb(0.12, 0.35, 0.72),
      borderWidth: 1.2,
    });

    lastPage.drawText('SA LUANG PITTAYAKHOM SCHOOL', {
      x: badgeX + 10,
      y: badgeY + badgeH - 14,
      size: 7.5,
      font: helveticaBold,
      color: rgb(0.12, 0.35, 0.72),
    });

    lastPage.drawText(`LESSON PLAN VERIFICATION: ${planId.substring(0, 8)}`, {
      x: badgeX + 10,
      y: badgeY + badgeH - 25,
      size: 6.8,
      font: helveticaBold,
      color: rgb(0.3, 0.4, 0.5),
    });

    lastPage.drawText(`Level: 1/5 Teacher Submission Verified`, {
      x: badgeX + 10,
      y: badgeY + badgeH - 37,
      size: 6.8,
      font: helveticaBold,
      color: rgb(0.05, 0.5, 0.25),
    });

    const timestampStr = dateObj.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    lastPage.drawText(`Timestamp: ${timestampStr}`, {
      x: badgeX + 10,
      y: badgeY + (isPage2Last ? 8 : 14),
      size: 6.0,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });

    // Sync any previous/existing reviewer signatures to Page 2
    if (planId) {
      await this.syncAllSignaturesToPage2Internal(pdfDoc, planId, thaiFont, helveticaBold);
    }

    // Save stamped PDF
    const outputPath = path.join(stampedDir, `${planId}_certified.pdf`);
    const stampedPdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, stampedPdfBytes);

    console.log(`[PdfService] Stamped Teacher signature in Slot 1 for plan ${planId}`);
    return outputPath;
  }

  /**
   * Reviewer approval stamping:
   * Stamps each reviewer's signature directly into their corresponding designated slot
   * on Page 1 (The official memo form).
   * Supports:
   * - dept_head -> Slot 2 (หัวหน้ากลุ่มสาระฯ)
   * - curriculum_head / academic_head -> Slot 3 (งานพัฒนาคุณภาพการจัดการเรียนการสอน)
   * - academic_director -> Slot 4 (รองผู้อำนวยการฝ่ายวิชาการ + บันทึกความเห็น)
   * - director -> Slot 5 (ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม)
   */
  async stampReviewerSignature({
    planId,
    stageKey,
    signatureBase64,
    reviewerName,
    reviewerRole,
    feedback,
    signedAt = new Date(),
    column = 1
  }) {
    const targetPath = path.join(stampedDir, `${planId}_certified.pdf`);
    if (!fs.existsSync(targetPath)) {
      console.warn(`[PdfService] Stamped PDF not found at ${targetPath}, cannot stamp reviewer signature.`);
      return null;
    }

    const pdfBytes = fs.readFileSync(targetPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pages = pdfDoc.getPages();
    if (pages.length === 0) return null;

    // Page 1 contains the official memo form
    const memoPage = pages[0];
    const { width, height } = memoPage.getSize();
    const slots = this.getSlotCoordinates(width, height, column);

    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const thaiFont = await this.getThaiFont(pdfDoc);

    // Get the target slot for this reviewer stage
    const slot = slots[stageKey];
    if (!slot) {
      console.warn(`[PdfService] No slot defined for stageKey: ${stageKey}`);
      return null;
    }

    // 1. Embed and Draw the Reviewer's Signature into their designated slot (on the dotted line 'ลงชื่อ')
    const sigImage = await this.embedSignature(pdfDoc, signatureBase64);

    if (sigImage) {
      const dims = sigImage.scale(0.35);
      const scale = Math.min(slot.width / dims.width, slot.height / dims.height, 1);
      const renderW = dims.width * scale;
      const renderH = dims.height * scale;

      memoPage.drawImage(sigImage, {
        x: slot.centerX - (renderW / 2),
        y: slot.centerY - (renderH / 2) + 2,
        width: renderW,
        height: renderH,
      });
    } else {
      // Clean fallback stamp with ASCII-safe reviewer info
      const safeLabel = toAsciiSafe(reviewerName, toAsciiSafe(reviewerRole, 'Reviewer'));
      try {
        memoPage.drawText(`[e-Signed: ${safeLabel}]`, {
          x: slot.centerX - 35,
          y: slot.centerY + 2,
          size: 6.8,
          font: helveticaBold,
          color: rgb(0.1, 0.4, 0.7),
        });
      } catch (e) {
        // Safe skip text if encoding fails
      }
    }

    // 1.1 Embed and Draw Reviewer's Signature on Page 2 (แบบ นท.2)
    const allDocPages = pdfDoc.getPages();
    if (allDocPages.length >= 2) {
      const page2 = allDocPages[1];
      const { width: p2W, height: p2H } = page2.getSize();
      const p2Slots = this.getPage2SlotCoordinates(p2W, p2H);
      const p2Slot = p2Slots[stageKey];
      if (p2Slot) {
        this.drawSignatureImage(
          page2,
          p2Slot,
          sigImage,
          reviewerName ? `[e-Signed: ${toAsciiSafe(reviewerName, 'Reviewer')}]` : null,
          thaiFont,
          helveticaBold
        );
      }
    }

    // 2. Print reviewer full Thai name inside the existing parentheses on the template
    //    Template already has ( and ) printed - just insert the name text between them, no extra brackets
    if (slot.nameY && reviewerName) {
      try {
        const cleanName = reviewerName.replace(/[()]/g, '').trim();
        if (thaiFont) {
          const fontSize = 8.5;
          const nameCenterX = slot.nameX || slot.centerX;
          const textW = thaiFont.widthOfTextAtSize(cleanName, fontSize);
          memoPage.drawText(cleanName, {
            x: nameCenterX - (textW / 2),
            y: slot.nameY,
            size: fontSize,
            font: thaiFont,
            color: rgb(0.08, 0.12, 0.22),
          });
        }
      } catch (err) {
        console.warn('[PdfService] Error rendering Thai name in parentheses:', err.message);
      }
    }

    // 3. If reviewer is academic_director, write feedback/comment on the comment line
    if (stageKey === 'academic_director' && slot.commentY && feedback) {
      try {
        const cleanFeedback = feedback.trim();
        const commentCenterX = slot.commentX || slot.centerX;
        if (thaiFont) {
          const maxWidth = 160;
          const fullW = thaiFont.widthOfTextAtSize(cleanFeedback, 7.0);
          let line1 = '';
          let line2 = '';
          if (cleanFeedback.includes('\n')) {
            const parts = cleanFeedback.split('\n');
            line1 = parts[0].trim();
            line2 = parts.slice(1).join(' ').trim();
          } else if (fullW <= maxWidth) {
            line1 = cleanFeedback;
          } else {
            // Split into 2 lines for the two dotted comment lines
            const mid = Math.floor(cleanFeedback.length / 2);
            let splitIdx = cleanFeedback.lastIndexOf(' ', mid + 8);
            if (splitIdx <= 5) splitIdx = mid;
            line1 = cleanFeedback.substring(0, splitIdx).trim();
            line2 = cleanFeedback.substring(splitIdx).trim();
          }

          if (line1) {
            const w1 = thaiFont.widthOfTextAtSize(line1, 7.0);
            memoPage.drawText(line1, {
              x: commentCenterX - (w1 / 2),
              y: slot.commentY,
              size: 7.0,
              font: thaiFont,
              color: rgb(0.15, 0.2, 0.3),
            });
          }

          if (slot.commentY2 && line2) {
            const w2 = thaiFont.widthOfTextAtSize(line2, 6.8);
            memoPage.drawText(line2, {
              x: commentCenterX - (w2 / 2),
              y: slot.commentY2,
              size: 6.8,
              font: thaiFont,
              color: rgb(0.15, 0.2, 0.3),
            });
          }
        } else {
          const asciiComment = toAsciiSafe(cleanFeedback, 'Verified: Approved syllabus.');
          memoPage.drawText(asciiComment, {
            x: commentCenterX - 75,
            y: slot.commentY,
            size: 7,
            font: helvetica,
            color: rgb(0.15, 0.2, 0.3),
          });
        }
      } catch (err) {
        console.warn('[PdfService] Error rendering comment:', err.message);
      }
    }

    // 3. Update the audit badge on the last page
    const lastPage = pages[pages.length - 1];
    const lastPageSize = lastPage.getSize();
    const isPage2Last = pages.length <= 2;
    const badgeW = isPage2Last ? 210 : 240;
    const badgeH = isPage2Last ? 68 : 95;
    const badgeX = isPage2Last ? 45 : (lastPageSize.width - badgeW - 25);
    const badgeY = isPage2Last ? 16 : 30;

    const dateObj = new Date(signedAt);
    const timestampStr = dateObj.toISOString().replace('T', ' ').substring(0, 19);

    const stageLabels = {
      dept_head: 'Dept Head',
      curriculum_head: 'Curriculum',
      academic_head: 'Curriculum',
      academic_director: 'Academic Vice Dir',
      director: 'School Director'
    };
    const stageLabel = stageLabels[stageKey] || stageKey;

    // Mask latest approval line cleanly
    lastPage.drawRectangle({
      x: badgeX + 8,
      y: badgeY + (isPage2Last ? 6 : 22),
      width: badgeW - 16,
      height: 12,
      color: rgb(0.97, 0.98, 1.0),
    });

    lastPage.drawText(`Approved: ${stageLabel} (${timestampStr})`, {
      x: badgeX + 10,
      y: badgeY + (isPage2Last ? 8 : 24),
      size: 5.8,
      font: helveticaBold,
      color: rgb(0.1, 0.4, 0.2),
    });

    // 4. Ensure all signatures for this plan (Teacher + all approved Reviewers) are on Page 2
    try {
      await this.syncAllSignaturesToPage2Internal(pdfDoc, planId, thaiFont, helveticaBold);
    } catch (syncErr) {
      console.warn('[PdfService] syncAllSignaturesToPage2 error:', syncErr.message);
    }

    const updatedBytes = await pdfDoc.save();
    fs.writeFileSync(targetPath, updatedBytes);

    console.log(`[PdfService] Successfully stamped ${stageKey} signature into designated memo slot and Page 2 for plan ${planId}`);
    return targetPath;
  }

  /**
   * Internal helper: Sync all available signatures for planId onto Page 2 (นท.2)
   */
  async syncAllSignaturesToPage2Internal(pdfDoc, planId, thaiFont = null, helveticaBold = null) {
    if (!pdfDoc || !planId) return false;
    const pages = pdfDoc.getPages();
    if (pages.length < 2) return false;

    const page2 = pages[1];
    const { width: p2W, height: p2H } = page2.getSize();
    const p2Slots = this.getPage2SlotCoordinates(p2W, p2H);

    try {
      // 1. Teacher signature from lesson_plans
      const plan = await db.get(
        'SELECT signature_data, round_2_signature, teacher_name FROM lesson_plans WHERE id = ?',
        [planId]
      );
      if (plan) {
        const teacherSig = plan.signature_data || plan.round_2_signature;
        if (teacherSig) {
          const teacherSigImg = await this.embedSignature(pdfDoc, teacherSig);
          if (teacherSigImg) {
            this.drawSignatureImage(page2, p2Slots.teacher, teacherSigImg, null, thaiFont, helveticaBold);
          }
        }
      }

      // 2. Reviewer signatures from approval_timeline
      const timelineRows = await db.query(
        `SELECT stage_key, reviewer_name, reviewer_role, reviewer_signature 
         FROM approval_timeline 
         WHERE lesson_plan_id = ? AND status = 'completed' AND reviewer_signature IS NOT NULL
         ORDER BY step_order ASC`,
        [planId]
      );

      if (timelineRows && timelineRows.length > 0) {
        for (const row of timelineRows) {
          const targetSlot = p2Slots[row.stage_key];
          if (targetSlot && row.reviewer_signature) {
            const rowSigImg = await this.embedSignature(pdfDoc, row.reviewer_signature);
            if (rowSigImg) {
              this.drawSignatureImage(page2, targetSlot, rowSigImg, null, thaiFont, helveticaBold);
            }
          }
        }
      }
      return true;
    } catch (dbErr) {
      console.warn(`[PdfService] Error syncing signatures from DB to Page 2 for plan ${planId}:`, dbErr.message);
      return false;
    }
  }

  /**
   * Public helper: Sync and stamp all recorded signatures (Teacher + All Reviewers) onto Page 2
   */
  async syncAllSignaturesToPage2(planId) {
    const targetPath = path.join(stampedDir, `${planId}_certified.pdf`);
    if (!fs.existsSync(targetPath)) return null;

    try {
      const pdfBytes = fs.readFileSync(targetPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pages = pdfDoc.getPages();
      if (pages.length < 2) return targetPath;

      const thaiFont = await this.getThaiFont(pdfDoc);
      const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const synced = await this.syncAllSignaturesToPage2Internal(pdfDoc, planId, thaiFont, helveticaBold);
      if (synced) {
        const updatedBytes = await pdfDoc.save();
        fs.writeFileSync(targetPath, updatedBytes);
        console.log(`[PdfService] Successfully synced all signatures onto Page 2 for plan ${planId}`);
      }
      return targetPath;
    } catch (err) {
      console.warn(`[PdfService] Failed to sync signatures to Page 2 for plan ${planId}:`, err.message);
      return targetPath;
    }
  }
}

function toAsciiSafe(str, fallback = '') {
  if (!str) return fallback;
  const clean = str.replace(/[^\x20-\x7E]/g, '').trim();
  return clean || fallback;
}

// Helper to handle font function
function helveticaFont(boldFont) {
  return boldFont;
}

export const pdfService = new PdfService();
