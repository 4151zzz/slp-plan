import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    const scaleX = pageWidth / 723;
    const scaleY = pageHeight / 1024;

    const toPdfX = (imgX) => imgX * scaleX;
    const toPdfY = (imgY) => pageHeight - (imgY * scaleY);

    const isCol2 = column === 2 || column === '2';

    return {
      // Slot 1: Teacher (ผู้สอน) -> Dotted line at y = 561
      teacher: {
        centerX: toPdfX(isCol2 ? 502 : 195),
        centerY: toPdfY(550),
        width: 70 * scaleX,
        height: 20 * scaleY,
        dateX: toPdfX(isCol2 ? 503 : 160),
        dateY: toPdfY(488),
      },
      // Slot 2: Head of Department (หัวหน้ากลุ่มสาระฯ) -> Dotted line at y = 593
      dept_head: {
        centerX: toPdfX(isCol2 ? 489 : 195),
        centerY: toPdfY(582),
        width: 70 * scaleX,
        height: 20 * scaleY,
      },
      // Slot 3: Curriculum / Academic Affairs Head (งานพัฒนาคุณภาพการจัดการเรียนการสอน)
      // Dotted line at y = 637, Parentheses at y = 659
      curriculum_head: {
        centerX: toPdfX(isCol2 ? 504 : 195),
        centerY: toPdfY(626),
        width: 70 * scaleX,
        height: 20 * scaleY,
        nameX: toPdfX(isCol2 ? 518 : 221.5),
        nameY: toPdfY(659),
      },
      academic_head: {
        centerX: toPdfX(isCol2 ? 504 : 195),
        centerY: toPdfY(626),
        width: 70 * scaleX,
        height: 20 * scaleY,
        nameX: toPdfX(isCol2 ? 518 : 221.5),
        nameY: toPdfY(659),
      },
      // Slot 4: Vice Director for Academic Affairs (รองผู้อำนวยการฝ่ายวิชาการ)
      // Comment line 1 at y = 725, Comment line 2 at y = 747
      // Dotted line at y = 769, Parentheses at y = 787
      academic_director: {
        centerX: toPdfX(isCol2 ? 500 : 213),
        centerY: toPdfY(760),
        width: 70 * scaleX,
        height: 20 * scaleY,
        commentX: toPdfX(isCol2 ? 503 : 212.5),
        commentY: toPdfY(722),
        commentY2: toPdfY(744),
        nameX: toPdfX(isCol2 ? 505 : 213),
        nameY: toPdfY(787),
      },
      // Slot 5: School Director (ผู้อำนวยการโรงเรียนสระหลวงพิทยาคม)
      // Dotted line at y = 835 -> centerY at y = 825
      // "นางนิกูล ทองหน้าศาล" is preprinted on template without parentheses
      director: {
        centerX: toPdfX(isCol2 ? 505 : 213),
        centerY: toPdfY(825),
        width: 70 * scaleX,
        height: 20 * scaleY,
      }
    };
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
        'C:/Windows/Fonts/tahoma.ttf',
        'C:/Windows/Fonts/cordia.ttf',
        'C:/Windows/Fonts/angsana.ttf',
        'C:/Windows/Fonts/arial.ttf'
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

    if (isCol2 && fs.existsSync(certifiedPath) && pages.length > 0) {
      // Use existing cover page
      memoPage = pages[0];
    } else if (fs.existsSync(templatePath)) {
      const templateBytes = fs.readFileSync(templatePath);
      const templateImage = await pdfDoc.embedPng(templateBytes);

      // Prepend a pristine A4 Memo Page at the front (index 0)
      memoPage = pdfDoc.insertPage(0, [a4Width, a4Height]);

      memoPage.drawImage(templateImage, {
        x: 0,
        y: 0,
        width: a4Width,
        height: a4Height,
      });
    } else {
      // Fallback: use first page of existing document
      if (pages.length === 0) {
        memoPage = pdfDoc.addPage([a4Width, a4Height]);
      } else {
        memoPage = pages[0];
      }
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

    // 2. Stamp Thai Date on Column 2 date dotted line
    const dateObj = new Date(signedAt);
    if (isCol2 && thaiFont) {
      try {
        const dayStr = String(dateObj.getDate());
        const monthStr = THAI_MONTHS[dateObj.getMonth()] || '';
        const yearStr = String(dateObj.getFullYear() + 543);
        const fontSize = 8.0;

        const scaleX = width / 723;
        const scaleY = height / 1024;
        const toPdfX = (imgX) => imgX * scaleX;
        const toPdfY = (imgY) => height - (imgY * scaleY);

        const dayW = thaiFont.widthOfTextAtSize(dayStr, fontSize);
        memoPage.drawText(dayStr, {
          x: toPdfX(432) - (dayW / 2),
          y: toPdfY(525),
          size: fontSize,
          font: thaiFont,
          color: rgb(0.08, 0.12, 0.22)
        });

        const monthW = thaiFont.widthOfTextAtSize(monthStr, fontSize);
        memoPage.drawText(monthStr, {
          x: toPdfX(505) - (monthW / 2),
          y: toPdfY(525),
          size: fontSize,
          font: thaiFont,
          color: rgb(0.08, 0.12, 0.22)
        });

        const yearW = thaiFont.widthOfTextAtSize(yearStr, fontSize);
        memoPage.drawText(yearStr, {
          x: toPdfX(580) - (yearW / 2),
          y: toPdfY(525),
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

    const badgeW = 240;
    const badgeH = 95;
    const badgeX = lastPageSize.width - badgeW - 25;
    const badgeY = 30;

    lastPage.drawRectangle({
      x: badgeX,
      y: badgeY,
      width: badgeW,
      height: badgeH,
      color: rgb(0.97, 0.98, 1.0),
      borderColor: rgb(0.12, 0.35, 0.72),
      borderWidth: 1.5,
    });

    lastPage.drawText('SA LUANG PITTAYAKHOM SCHOOL', {
      x: badgeX + 12,
      y: badgeY + badgeH - 16,
      size: 8,
      font: helveticaBold,
      color: rgb(0.12, 0.35, 0.72),
    });

    lastPage.drawText(`LESSON PLAN VERIFICATION: ${planId.substring(0, 8)}`, {
      x: badgeX + 12,
      y: badgeY + badgeH - 28,
      size: 7,
      font: helveticaFont(helveticaBold),
      color: rgb(0.3, 0.4, 0.5),
    });

    lastPage.drawText(`Level: 1/5 Teacher Submission Verified`, {
      x: badgeX + 12,
      y: badgeY + badgeH - 42,
      size: 7,
      font: helveticaBold,
      color: rgb(0.05, 0.5, 0.25),
    });

    const timestampStr = dateObj.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    lastPage.drawText(`Timestamp: ${timestampStr}`, {
      x: badgeX + 12,
      y: badgeY + 14,
      size: 6.5,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });

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
    const dateObj = new Date(signedAt);
    const timestampStr = dateObj.toISOString().replace('T', ' ').substring(0, 19);

    // Add approval stamp entry on last page
    const badgeW = 240;
    const badgeH = 95;
    const badgeX = lastPage.getSize().width - badgeW - 25;
    const badgeY = 30;

    // Small indicator on badge
    lastPage.drawText(`Approved: ${stageKey} (${timestampStr})`, {
      x: badgeX + 12,
      y: badgeY + 24,
      size: 6,
      font: helvetica,
      color: rgb(0.1, 0.4, 0.2),
    });

    const updatedBytes = await pdfDoc.save();
    fs.writeFileSync(targetPath, updatedBytes);

    console.log(`[PdfService] Successfully stamped ${stageKey} signature into designated memo slot for plan ${planId}`);
    return targetPath;
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
