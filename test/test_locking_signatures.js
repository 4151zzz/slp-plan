import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testLockingSignatures() {
  const targetPdf = path.resolve(__dirname, 'เทส.pdf');
  const sigsPath = path.resolve(__dirname, '../data/templates/sample_signatures.json');
  const signatures = JSON.parse(fs.readFileSync(sigsPath, 'utf8'));

  const pdfBytes = fs.readFileSync(targetPdf);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  pdfDoc.registerFontkit(fontkit);

  let thaiFont = null;
  const fontCandidates = [
    'C:/Windows/Fonts/tahoma.ttf',
    'C:/Windows/Fonts/cordia.ttf',
    'C:/Windows/Fonts/angsana.ttf',
  ];
  for (const f of fontCandidates) {
    if (fs.existsSync(f)) {
      thaiFont = await pdfDoc.embedFont(fs.readFileSync(f));
      break;
    }
  }

  const pages = pdfDoc.getPages();
  console.log(`Original page count in เทส.pdf: ${pages.length}`);

  const p1 = pages[0];
  const { width: p1W, height: p1H } = p1.getSize();
  const scale1X = p1W / 595.32;
  const scale1Y = p1H / 841.92;
  const toPdf1X = (x) => x * scale1X;
  const toPdf1Y = (topY) => p1H - (topY * scale1Y);

  // Locked coordinates for Page 1 based on real layout
  const p1SlotsCol1 = {
    teacher: { centerX: toPdf1X(170), centerY: toPdf1Y(449), width: 80 * scale1X, height: 22 * scale1Y },
    dept_head: { centerX: toPdf1X(175), centerY: toPdf1Y(479), width: 80 * scale1X, height: 22 * scale1Y },
    curriculum_head: { centerX: toPdf1X(175), centerY: toPdf1Y(514), width: 80 * scale1X, height: 22 * scale1Y },
    academic_director: { centerX: toPdf1X(175), centerY: toPdf1Y(623), width: 80 * scale1X, height: 22 * scale1Y },
    director: { centerX: toPdf1X(175), centerY: toPdf1Y(677), width: 80 * scale1X, height: 22 * scale1Y }
  };

  const p1SlotsCol2 = {
    teacher: { centerX: toPdf1X(410), centerY: toPdf1Y(449), width: 80 * scale1X, height: 22 * scale1Y },
    dept_head: { centerX: toPdf1X(410), centerY: toPdf1Y(479), width: 80 * scale1X, height: 22 * scale1Y },
    curriculum_head: { centerX: toPdf1X(410), centerY: toPdf1Y(514), width: 80 * scale1X, height: 22 * scale1Y },
    academic_director: { centerX: toPdf1X(410), centerY: toPdf1Y(623), width: 80 * scale1X, height: 22 * scale1Y },
    director: { centerX: toPdf1X(410), centerY: toPdf1Y(677), width: 80 * scale1X, height: 22 * scale1Y }
  };

  // Stamp Page 1 Col 1 & Col 2
  for (const [role, slot] of Object.entries(p1SlotsCol1)) {
    const sigB64 = signatures[role];
    if (sigB64) {
      const imgBuffer = Buffer.from(sigB64.split('base64,')[1], 'base64');
      const sigImg = await pdfDoc.embedPng(imgBuffer);
      const dims = sigImg.scale(0.35);
      const scale = Math.min(slot.width / dims.width, slot.height / dims.height, 1);
      const renderW = dims.width * scale;
      const renderH = dims.height * scale;
      p1.drawImage(sigImg, {
        x: slot.centerX - (renderW / 2),
        y: slot.centerY - (renderH / 2) + 2,
        width: renderW,
        height: renderH,
      });
    }
  }

  for (const [role, slot] of Object.entries(p1SlotsCol2)) {
    const sigB64 = signatures[role];
    if (sigB64) {
      const imgBuffer = Buffer.from(sigB64.split('base64,')[1], 'base64');
      const sigImg = await pdfDoc.embedPng(imgBuffer);
      const dims = sigImg.scale(0.35);
      const scale = Math.min(slot.width / dims.width, slot.height / dims.height, 1);
      const renderW = dims.width * scale;
      const renderH = dims.height * scale;
      p1.drawImage(sigImg, {
        x: slot.centerX - (renderW / 2),
        y: slot.centerY - (renderH / 2) + 2,
        width: renderW,
        height: renderH,
      });
    }
  }

  // Stamp Thai Date Col 2
  if (thaiFont) {
    p1.drawText('21', { x: toPdf1X(354), y: toPdf1Y(424), size: 8, font: thaiFont, color: rgb(0.08, 0.12, 0.22) });
    p1.drawText('พฤษภาคม', { x: toPdf1X(410), y: toPdf1Y(424), size: 8, font: thaiFont, color: rgb(0.08, 0.12, 0.22) });
    p1.drawText('2569', { x: toPdf1X(475), y: toPdf1Y(424), size: 8, font: thaiFont, color: rgb(0.08, 0.12, 0.22) });
  }

  // Stamp Academic Director comment on dotted lines Col 1 & 2
  if (thaiFont) {
    p1.drawText('เห็นชอบตามเสนอ', { x: toPdf1X(135), y: toPdf1Y(586), size: 7.5, font: thaiFont, color: rgb(0.15, 0.2, 0.3) });
    p1.drawText('สามารถนำไปใช้ในการจัดการเรียนรู้ได้', { x: toPdf1X(110), y: toPdf1Y(604), size: 7.0, font: thaiFont, color: rgb(0.15, 0.2, 0.3) });

    p1.drawText('เห็นชอบตามเสนอ', { x: toPdf1X(375), y: toPdf1Y(586), size: 7.5, font: thaiFont, color: rgb(0.15, 0.2, 0.3) });
    p1.drawText('สามารถนำไปใช้ในการจัดการเรียนรู้ได้', { x: toPdf1X(350), y: toPdf1Y(604), size: 7.0, font: thaiFont, color: rgb(0.15, 0.2, 0.3) });
  }

  // Page 2 - นท.2
  const p2 = pages[1];
  const { width: p2W, height: p2H } = p2.getSize();
  const scale2X = p2W / 595.32;
  const scale2Y = p2H / 841.92;
  const toPdf2X = (x) => x * scale2X;
  const toPdf2Y = (topY) => p2H - (topY * scale2Y);

  const p2Slots = {
    teacher: { centerX: toPdf2X(430), centerY: toPdf2Y(609), width: 100 * scale2X, height: 25 * scale2Y },
    dept_head: { centerX: toPdf2X(170), centerY: toPdf2Y(608), width: 100 * scale2X, height: 25 * scale2Y },
    curriculum_head: { centerX: toPdf2X(165), centerY: toPdf2Y(678), width: 100 * scale2X, height: 25 * scale2Y, nameX: toPdf2X(165), nameY: toPdf2Y(701) },
    academic_director: { centerX: toPdf2X(430), centerY: toPdf2Y(676), width: 100 * scale2X, height: 25 * scale2Y },
    director: { centerX: toPdf2X(440), centerY: toPdf2Y(757), width: 100 * scale2X, height: 25 * scale2Y }
  };

  for (const [role, slot] of Object.entries(p2Slots)) {
    const sigB64 = signatures[role];
    if (sigB64) {
      const imgBuffer = Buffer.from(sigB64.split('base64,')[1], 'base64');
      const sigImg = await pdfDoc.embedPng(imgBuffer);
      const dims = sigImg.scale(0.35);
      const scale = Math.min(slot.width / dims.width, slot.height / dims.height, 1);
      const renderW = dims.width * scale;
      const renderH = dims.height * scale;
      p2.drawImage(sigImg, {
        x: slot.centerX - (renderW / 2),
        y: slot.centerY - (renderH / 2) + 2,
        width: renderW,
        height: renderH,
      });
    }

    if (role === 'curriculum_head' && slot.nameY && thaiFont) {
      const cleanName = 'นางเครือมาส คำเขียน';
      const fontSize = 8.0;
      const textW = thaiFont.widthOfTextAtSize(cleanName, fontSize);
      p2.drawRectangle({
        x: slot.nameX - (textW / 2) - 4,
        y: slot.nameY - 2,
        width: textW + 8,
        height: 12,
        color: rgb(1, 1, 1),
      });
      p2.drawText(cleanName, {
        x: slot.nameX - (textW / 2),
        y: slot.nameY,
        size: fontSize,
        font: thaiFont,
        color: rgb(0.08, 0.12, 0.22),
      });
    }
  }

  // Draw Bottom-Left Verification Badge on Page 2
  p2.drawRectangle({
    x: 45,
    y: 16,
    width: 210,
    height: 68,
    color: rgb(0.97, 0.98, 1.0),
    borderColor: rgb(0.12, 0.35, 0.72),
    borderWidth: 1.2,
  });

  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  p2.drawText('SA LUANG PITTAYAKHOM SCHOOL', { x: 55, y: 70, size: 7.5, font: helveticaBold, color: rgb(0.12, 0.35, 0.72) });
  p2.drawText('LESSON PLAN VERIFICATION: VERIFIED', { x: 55, y: 58, size: 6.8, font: helveticaBold, color: rgb(0.3, 0.4, 0.5) });
  p2.drawText('Status: 5/5 Full Approval Certified', { x: 55, y: 46, size: 6.8, font: helveticaBold, color: rgb(0.05, 0.5, 0.25) });
  p2.drawText('Approved: School Director Approved', { x: 55, y: 34, size: 6.0, font: helveticaBold, color: rgb(0.1, 0.4, 0.2) });
  p2.drawText('Timestamp: 2026-10-09 17:45:00 UTC', { x: 55, y: 24, size: 6.0, font: helvetica, color: rgb(0.4, 0.4, 0.4) });

  const outPath = path.resolve(__dirname, '../public/locked_signatures_preview.pdf');
  fs.writeFileSync(outPath, await pdfDoc.save());
  console.log(`✅ Stamped & Locked PDF created at: ${outPath}`);
}

testLockingSignatures().catch(console.error);
