// 自己チェック。node test.mjs で走る（フレームワークなし）。
// calc.js を読み、仕様（docs/private/specs/capgift.md「8.」）の自己チェックを確かめる。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

vm.runInThisContext(fs.readFileSync(new URL('./calc.js', import.meta.url), 'utf8'), { filename: 'calc.js' });
const { estimate, bands, affiliateLink, searchUrl, bandLink } = globalThis.Capgift;

const test = (name, fn) => { fn(); console.log('✓', name); };
const person = (income, extra = {}) => ({ income, spouse: false, hs: 0, uni: 0, social: null, donated: 0, ...extra });

// 仕様「8.」の自己チェック用の値（社会保険料15%で見積もり）。
const CASES = [
  { income: 300, extra: {}, rate: 0.05, resident: 111500, cap: 28000 },
  { income: 500, extra: {}, rate: 0.05, resident: 235500, cap: 57000 },
  { income: 700, extra: {}, rate: 0.20, resident: 369500, cap: 108000 },
  { income: 1000, extra: {}, rate: 0.20, resident: 609500, cap: 177000 },
  { income: 500, extra: { spouse: true }, rate: 0.05, resident: 202500, cap: 49000 },
  { income: 500, extra: { uni: 1 }, rate: 0.05, resident: 181500, cap: 44000 },
];

test('自己チェックの6件が合う', () => {
  for (const c of CASES) {
    const r = estimate(person(c.income, c.extra));
    assert.equal(r.incomeTaxRate, c.rate, `income=${c.income} rate`);
    assert.equal(r.residentIncomeTaxYen, c.resident, `income=${c.income} resident`);
    assert.equal(r.capYen, c.cap, `income=${c.income} cap`);
  }
});

test('年収0〜3,000万を10万刻み: 上限は年収について減らない・NaNが出ない', () => {
  let prevCap = -Infinity;
  for (let income = 0; income <= 3000; income += 10) {
    const r = estimate(person(income));
    assert.ok(r != null, `income=${income}`);
    assert.ok(Number.isFinite(r.capYen), `income=${income} capYen NaN`);
    assert.ok(Number.isFinite(r.residentIncomeTaxYen), `income=${income} residentIncomeTaxYen NaN`);
    assert.ok(r.capYen >= prevCap, `income=${income} 上限が減った (${prevCap} → ${r.capYen})`);
    prevCap = r.capYen;
  }
});

test('所得割が0のときの表示（年収が低い・控除が多い）', () => {
  const r = estimate(person(100, { uni: 2 }));
  assert.equal(r.residentIncomeTaxYen, 0);
  assert.equal(r.capYen, 0);
  assert.equal(r.noDeduction, true);
});

test('income が null なら結果を出さない', () => {
  assert.equal(estimate(person(null)), null);
});

test('残りの帯: min・max は正の整数で min < max', () => {
  for (let remaining = 0; remaining <= 200000; remaining += 500) {
    for (const b of bands(remaining)) {
      assert.ok(Number.isInteger(b.min) && b.min > 0, `remaining=${remaining} min=${b.min}`);
      assert.ok(Number.isInteger(b.max) && b.max > 0, `remaining=${remaining} max=${b.max}`);
      assert.ok(b.min < b.max, `remaining=${remaining} ${b.id} min=${b.min} max=${b.max}`);
    }
  }
  // 残りが十分あれば3つとも出る
  assert.equal(bands(50000).length, 3);
  // 残りが小さいと出ない
  assert.equal(bands(0).length, 0);
});

test('作ったリンクは hb.afl.rakuten.co.jp で始まり、ev=40 と min・max を含む', () => {
  const url = bandLink('rice', 28000, 41000);
  assert.match(url, /^https:\/\/hb\.afl\.rakuten\.co\.jp\/hgc\//);
  const pcParam = new URL(url).searchParams.get('pc');
  assert.ok(pcParam, 'pc パラメータがない');
  const inner = new URL(pcParam);
  assert.equal(inner.hostname, 'search.rakuten.co.jp');
  assert.equal(inner.searchParams.get('ev'), '40');
  assert.equal(inner.searchParams.get('min'), '28000');
  assert.equal(inner.searchParams.get('max'), '41000');
  assert.match(decodeURIComponent(inner.pathname), /ふるさと納税 米/);
});

test('検索URLの種類（すべて）はキーワードが「ふるさと納税」だけ', () => {
  const url = searchUrl('all', 1000, 2000);
  assert.match(decodeURIComponent(url), /event\/ふるさと納税\//);
});
