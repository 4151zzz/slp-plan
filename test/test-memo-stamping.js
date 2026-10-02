import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateTestMemoPdf() {
  console.log('Generating test PDF from memo template...');
  const templatePath = path.resolve(__dirname, '../data/templates/memo_template.png');
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.create();
  // Standard A4
  const a4Width = 595.28;
  const a4Height = 841.89;
  const page = pdfDoc.addPage([a4Width, a4Height]);

  // Embed the memo template image as the background of Page 1
  const templateImage = await pdfDoc.embedPng(templateBytes);
  page.drawImage(templateImage, {
    x: 0,
    y: 0,
    width: a4Width,
    height: a4Height,
  });

  // Coordinates mapping
  // scaleX: a4Width / 723 = 0.823347
  // scaleY: a4Height / 1024 = 0.822158
  const toPdfX = (imgX) => (imgX / 723) * a4Width;
  const toPdfY = (imgY) => a4Height - ((imgY / 1024) * a4Height);

  // Generate simple sample signature images (or mock signatures)
  // Let's create mock signature PNGs with different colors for each tier:
  // 1: Teacher (Blue)
  // 2: Dept Head (Green)
  // 3: Curriculum/Academic (Purple)
  // 4: Vice Director (Dark Orange)
  // 5: Director (Navy)

  // Use a mock signature PNG or draw sample signatures
  // We can load public/images/logo-64.png or create simple signature drawings
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Slot definitions for Column 1
  const slotsCol1 = {
    teacher: { x: toPdfX(165), y: toPdfY(558), label: 'Somchai (Teacher)', dateY: toPdfY(514) },
    dept_head: { x: toPdfX(165), y: toPdfY(590), label: 'Malee (Dept Head)' },
    curriculum_head: { x: toPdfX(165), y: toPdfY(670), label: 'Orathai (Curriculum)' },
    academic_director: { x: toPdfX(165), y: toPdfY(780), label: 'Prasit (Vice Director)', commentY: toPdfY(744) },
    director: { x: toPdfX(165), y: toPdfY(830), label: 'Nikoon (Director)' }
  };

  // Draw indicators/stamps for each slot
  for (const [key, slot] of Object.entries(slotsCol1)) {
    // Draw a neat signature stamp box
    page.drawRectangle({
      x: slot.x - 45,
      y: slot.y,
      width: 90,
      height: 22,
      color: rgb(0.92, 0.96, 1.0),
      borderColor: rgb(0.15, 0.4, 0.85),
      borderWidth: 1,
    });

    page.drawText(`E-SIG: ${slot.label.split(' ')[0]}`, {
      x: slot.x - 40,
      y: slot.y + 6,
      size: 7,
      font: helveticaBold,
      color: rgb(0.1, 0.3, 0.7),
    });
  }

  // Draw comment for Vice Director
  page.drawText('Approved: High academic quality & complete syllabus.', {
    x: toPdfX(95),
    y: slotsCol1.academic_director.commentY,
    size: 7.5,
    font: helvetica,
    color: rgb(0.15, 0.2, 0.3),
  });

  const outPath = path.resolve(__dirname, '../public/test_memo_stamped.pdf');
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, pdfBytes);
  console.log('Saved test memo PDF to:', outPath);
}

generateTestMemoPdf();
