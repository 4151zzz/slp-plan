import fs from 'fs';
import path from 'path';

function auditFile(filePath, jsContent) {
  const html = fs.readFileSync(filePath, 'utf8');
  const matches = [...html.matchAll(/onclick=["']([^"']+)["']/g)];
  console.log(`\n=== Auditing ${filePath} (${matches.length} onclick handlers) ===`);

  const funcs = new Set();
  matches.forEach(m => {
    const raw = m[1].trim();
    // extract function name before (
    const fnMatch = raw.match(/^([a-zA-Z0-9_$]+)\s*\(/);
    if (fnMatch) {
      funcs.add({ raw, name: fnMatch[1] });
    } else {
      console.log('Inline or special onclick:', raw);
    }
  });

  funcs.forEach(f => {
    const fnDeclRegex = new RegExp('(?:function\\s+' + f.name + '\\s*\\(|(?:const|let|var|window\\.)\\s*' + f.name + '\\s*=\\s*)');
    const inJs = jsContent ? fnDeclRegex.test(jsContent) : false;
    const inHtml = fnDeclRegex.test(html);
    const isGlobalOrBuiltin = ['alert', 'close', 'print'].includes(f.name);

    if (!inJs && !inHtml && !isGlobalOrBuiltin) {
      console.log(`❌ MISSING FUNCTION: ${f.name} (from: ${f.raw})`);
    } else {
      console.log(`✅ OK: ${f.name}`);
    }
  });
}

const appJs = fs.readFileSync('public/js/app.js', 'utf8');
auditFile('public/index.html', appJs);
auditFile('public/admin.html', null);
auditFile('public/login.html', null);
