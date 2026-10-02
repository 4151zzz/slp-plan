import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testThaiName() {
  console.log('Testing Thai font embedding and parentheses centering...');

  const templatePath = path.resolve(__dirname, '../data/templates/memo_template.png');
  const templateBytes = fs.readFileSync(templatePath);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  // Load Tahoma font from Windows Fonts
  const fontBytes = fs.readFileSync('C:/Windows/Fonts/tahoma.ttf');
  const tahomaFont = await pdfDoc.embedFont(fontBytes);

  const a4Width = 595.28;
  const a4Height = 841.89;
  const page = pdfDoc.addPage([a4Width, a4Height]);

  const templateImage = await pdfDoc.embedPng(templateBytes);
  page.drawImage(templateImage, {
    x: 0,
    y: 0,
    width: a4Width,
    height: a4Height,
  });

  const scaleX = a4Width / 723;
  const scaleY = a4Height / 1024;
  const toPdfX = (imgX) => imgX * scaleX;
  const toPdfY = (imgY) => a4Height - (imgY * scaleY);

  const centerX = toPdfX(195); // Column 1 center ~ 160.55 pt

  // Row 3 Parentheses line is at imgY = 672
  const nameR3 = '(นางอรทัย งานหลักสูตร)';
  const fontSize = 8.5;
  const textW3 = tahomaFont.widthOfTextAtSize(nameR3, fontSize);
  const textX3 = centerX - (textW3 / 2);
  const textY3 = toPdfY(670);

  page.drawText(nameR3, {
    x: textX3,
    y: textY3,
    size: fontSize,
    font: tahomaFont,
    color: rgb(0.1, 0.15, 0.25)
  });

  // Row 4 Parentheses line is at imgY = 808
  const nameR4 = '(ดร.ประสิทธิ์ ปัญญายิ่ง)';
  const textW4 = tahomaFont.widthOfTextAtSize(nameR4, fontSize);
  const textX4 = centerX - (textW4 / 2);
  const textY4 = toPdfY(807);

  page.drawText(nameR4, {
    x: textX4,
    y: textY4,
    size: fontSize,
    font: tahomaFont,
    color: rgb(0.1, 0.15, 0.25)
  });

  const outPath = path.resolve(__dirname, '../public/test_thai_parentheses.pdf');
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, pdfBytes);
  console.log('Saved test Thai parentheses PDF to:', outPath);
}

testThaiName();
