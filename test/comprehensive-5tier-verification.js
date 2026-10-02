import assert from 'assert';

const BASE_URL = 'http://127.0.0.1:3000';

async function testAll() {
  console.log('🔍 Running Full 5-Tier Verification Suite...\n');

  // 1. Check all users list
  const usersRes = await fetch(`${BASE_URL}/api/admin/users-list`);
  const usersJson = await usersRes.json();
  assert(usersJson.success, 'Failed to fetch users list');
  
  const requiredRoles = ['dept_head', 'curriculum_head', 'academic_head', 'academic_director', 'director'];
  for (const role of requiredRoles) {
    const found = usersJson.data.find(u => u.role === role);
    assert(found, `Missing user for role: ${role}`);
    console.log(`✅ Verified Role [${role}]: ${found.name} (${found.position_title})`);
  }

  // 2. Test timeline for existing plans
  const plansRes = await fetch(`${BASE_URL}/api/admin/plans`);
  const plansJson = await plansRes.json();
  assert(plansJson.success, 'Failed to fetch plans');
  console.log(`\n📋 Total Lesson Plans in DB: ${plansJson.data.length}`);

  let allHave5Steps = true;
  for (const p of plansJson.data) {
    const tRes = await fetch(`${BASE_URL}/api/plans/${p.id}/timeline`);
    const tJson = await tRes.json();
    if (!tJson.data.timeline || tJson.data.timeline.length !== 5) {
      allHave5Steps = false;
      console.error(`❌ Plan ${p.id} has ${tJson.data.timeline?.length} steps instead of 5`);
    }
  }
  assert(allHave5Steps, 'All plans must have exactly 5 timeline steps');
  console.log('✅ All lesson plans in system now have exactly 5 approval timeline tiers!');

  // 3. Verify specific step titles match user requirement
  const sampleTimelineRes = await fetch(`${BASE_URL}/api/plans/${plansJson.data[0].id}/timeline`);
  const sampleJson = await sampleTimelineRes.json();
  const steps = sampleJson.data.timeline;
  
  console.log('\n🔍 Verifying 5-Tier Stage Titles:');
  const expectedKeys = ['dept_head', 'curriculum_head', 'academic_head', 'academic_director', 'director'];
  steps.forEach((s, idx) => {
    console.log(`   Level ${idx + 1}: ${s.stage_title} (Key: ${s.stage_key})`);
    assert.strictEqual(s.stage_key, expectedKeys[idx], `Step ${idx + 1} key mismatch`);
  });

  // 4. Test KPI counts
  console.log('\n📊 Checking KPI Counts for each of the 5 roles:');
  for (const role of requiredRoles) {
    const rRes = await fetch(`${BASE_URL}/api/admin/plans?reviewer_role=${role}&filter_mode=my_turn`);
    const rJson = await rRes.json();
    console.log(`   ${role}: my_turn=${rJson.counts.my_turn}, waiting_others=${rJson.counts.waiting_others}, approved=${rJson.counts.approved}`);
  }

  console.log('\n🎉 ALL 5-TIER VERIFICATIONS COMPLETED SUCCESSFULLY! 🎉\n');
}

testAll().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
