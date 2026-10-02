import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createSamplePdf(outputPath) {
  const pdfDoc = await PDFDocument.create();
  const timesRomanFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.addPage([595, 842]); // A4 size
  const { width, height } = page.getSize();

  page.drawText('SCHOOL LESSON PLAN DOCUMENT', {
    x: 50,
    y: height - 80,
    size: 20,
    font: timesRomanFont,
    color: rgb(0.12, 0.23, 0.54)
  });

  page.drawText('Course: Advanced Computer Science (CS301)', {
    x: 50,
    y: height - 120,
    size: 14,
    font: helveticaFont,
    color: rgb(0.2, 0.2, 0.2)
  });

  page.drawText('Instructor: Teacher Test', {
    x: 50,
    y: height - 145,
    size: 12,
    font: helveticaFont,
    color: rgb(0.3, 0.3, 0.3)
  });

  page.drawText('Academic Term: 1/2569', {
    x: 50,
    y: height - 170,
    size: 12,
    font: helveticaFont,
    color: rgb(0.3, 0.3, 0.3)
  });

  const bodyText = [
    'Unit 1: Fundamentals of Algorithm Design and Complexity',
    'Unit 2: Asynchronous Programming and Distributed Queues',
    'Unit 3: Database Concurrency Control & Unique Integrity Constraints',
    'Unit 4: Digital Signatures and Document Verification',
    '',
    'Evaluation Criteria:',
    '- Laboratory Practical Work: 40%',
    '- Mid-term Examination: 30%',
    '- Final Lesson Plan Capstone Project: 30%'
  ];

  let currentY = height - 220;
  for (const line of bodyText) {
    page.drawText(line, {
      x: 50,
      y: currentY,
      size: 11,
      font: helveticaFont,
      color: rgb(0.25, 0.25, 0.25)
    });
    currentY -= 24;
  }

  const pdfBytes = await pdfDoc.save();
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`[Test] Generated sample PDF at: ${outputPath}`);
  return outputPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = path.join(__dirname, 'sample_plan.pdf');
  createSamplePdf(target);
}
