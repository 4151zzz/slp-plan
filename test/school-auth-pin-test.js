import http from 'http';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting School Gmail, PIN Security & Department Scoping Tests...');

  // Test 1: Teacher Login via School Gmail
  const t1 = await request('POST', '/api/auth/login', { email: 'teacher1@school.ac.th' });
  console.log('Test 1 (Teacher Login without PIN):', t1.status === 200 && t1.body.user.role === 'teacher' ? '✅ PASS' : '❌ FAIL');

  // Test 2: Department Head Login without PIN (Should challenge with requirePin)
  const t2 = await request('POST', '/api/auth/login', { email: 'head.science@school.ac.th' });
  console.log('Test 2 (Reviewer Login without PIN challenged):', t2.status === 401 && t2.body.requirePin ? '✅ PASS' : '❌ FAIL');

  // Test 3: Department Head Login with Wrong PIN
  const t3 = await request('POST', '/api/auth/login', { email: 'head.science@school.ac.th', pin: '9999' });
  console.log('Test 3 (Reviewer Login with Wrong PIN rejected):', t3.status === 401 && t3.body.message.includes('PIN') ? '✅ PASS' : '❌ FAIL');

  // Test 4: Department Head Login with Correct PIN
  const t4 = await request('POST', '/api/auth/login', { email: 'head.science@school.ac.th', pin: '1234' });
  console.log('Test 4 (Reviewer Login with Correct PIN 1234):', t4.status === 200 && t4.body.user.role === 'dept_head' ? '✅ PASS' : '❌ FAIL');

  // Test 5: Department Scoping for Science Head
  const t5 = await request('GET', '/api/admin/plans?reviewer_role=dept_head&reviewer_dept=' + encodeURIComponent('วิทยาศาสตร์และเทคโนโลยี'));
  const allScience = t5.body.data && t5.body.data.every(p => p.teacher_department === 'วิทยาศาสตร์และเทคโนโลยี');
  console.log('Test 5 (Science Head scoped to science only):', t5.status === 200 && allScience ? '✅ PASS' : '❌ FAIL', `Found ${t5.body.data ? t5.body.data.length : 0} plans`);

  // Test 6: Director can see all departments
  const t6 = await request('GET', '/api/admin/plans?reviewer_role=director');
  console.log('Test 6 (Director sees all departments):', t6.status === 200 && t6.body.data ? '✅ PASS' : '❌ FAIL', `Found ${t6.body.data ? t6.body.data.length : 0} plans`);

  console.log('🎉 All 6 Integration Tests Finished!');
}

runTests().catch(console.error);
