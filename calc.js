'use strict';

// ふるさと納税の控除上限の目安、と楽天ふるさと納税へのリンク作り。
// 画面にも保存にも触らない（node の test.mjs からも読む）。
//
// 出典（2026 年の寄付＝令和 8 年分の所得税・令和 9 年度分の住民税向け）:
// - 総務省「ふるさと納税のしくみ｜税金の控除について」
//   https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/furusato/mechanism/deduction.html
// - 国税庁 No.1155 ふるさと納税（寄附金控除） https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1155.htm
// - 国税庁「令和８年度税制改正による所得税の基礎控除の引上げ等について」（源泉所得税の改正のあらまし、令和8年4月）
//   https://www.nta.go.jp/users/gensen/2026kiso/index.htm
//   ここから: 給与所得控除の最低保障額は令和8・9年分 74万円（収入220万円以下）、
//   所得税の基礎控除は合計所得金額に応じて 104/62/67/62 万円（下の表）と確認した。
(function (root) {
  const MANEN = 10000;   // 1万円 = この円

  // 給与所得控除（年収 y 万円 → 控除額 万円）。850万円超は195万円で頭打ち（今回の改正で変更なし）。
  const SALARY_DEDUCTION_BRACKETS = [
    { max: 220, calc: () => 74 },                 // 最低保障額（令和8・9年分。改正前は190万円以下65万円）
    { max: 360, calc: (y) => y * 0.3 + 8 },
    { max: 660, calc: (y) => y * 0.2 + 44 },
    { max: 850, calc: (y) => y * 0.1 + 110 },
    { max: Infinity, calc: () => 195 },
  ];
  function salaryDeductionMan(incomeMan) {
    for (const b of SALARY_DEDUCTION_BRACKETS) if (incomeMan <= b.max) return b.calc(incomeMan);
  }

  // 所得税の基礎控除（合計所得金額 = 給与所得のみの前提 万円 → 控除額 万円。令和8・9年分）
  const INCOME_TAX_BASIC_DEDUCTION_BRACKETS = [
    { max: 336, amount: 104 },
    { max: 489, amount: 62 },
    { max: 655, amount: 67 },
    { max: 2350, amount: 62 },
    // ponytail: 2,350万円超の高所得者向けの逓減表（現行法で2,400万・2,450万・2,500万円が節目）は
    // 一次情報で確かめられなかった。年収およそ2,545万円超のごく一部にしか関わらないため、
    // 2,350万円以下と同じ62万円のまま据え置く簡略化にした。確かめたら上に段を足す。
    { max: Infinity, amount: 62 },
  ];
  function incomeTaxBasicDeductionMan(salaryIncomeMan) {
    for (const b of INCOME_TAX_BASIC_DEDUCTION_BRACKETS) if (salaryIncomeMan <= b.max) return b.amount;
  }

  const RESIDENT_BASIC_DEDUCTION_MAN = 43;   // 住民税の基礎控除（変更なし）

  // 所得税率（課税所得 万円 → 税率）
  const INCOME_TAX_RATE_BRACKETS = [
    { max: 195, rate: 0.05 },
    { max: 330, rate: 0.10 },
    { max: 695, rate: 0.20 },
    { max: 900, rate: 0.23 },
    { max: 1800, rate: 0.33 },
    { max: 4000, rate: 0.40 },
    { max: Infinity, rate: 0.45 },
  ];
  function incomeTaxRate(taxableMan) {
    if (taxableMan <= 0) return 0;
    for (const b of INCOME_TAX_RATE_BRACKETS) if (taxableMan <= b.max) return b.rate;
  }

  const floor1000 = (yen) => Math.floor(yen / 1000) * 1000;

  /**
   * @param {{income: number|null, spouse: boolean, hs: number, uni: number, social: number|null, donated: number}} input
   *   income: 年収（万円）。social: 万円（null なら年収の15%で見積もる）。donated: 円。
   * @returns {null | object} income が null なら null。
   */
  function estimate(input) {
    const { income, spouse, hs, uni, social, donated } = input;
    if (income == null || income < 0) return null;

    const salaryDeduction = salaryDeductionMan(income);
    const salaryIncome = Math.max(0, income - salaryDeduction);   // 給与所得（万円）
    const socialMan = social == null ? income * 0.15 : social;

    // 所得税
    const basicIncomeTax = incomeTaxBasicDeductionMan(salaryIncome);
    const taxableIncomeTax = Math.max(0, salaryIncome - socialMan - basicIncomeTax
      - (spouse ? 38 : 0) - hs * 38 - uni * 63);
    const rate = incomeTaxRate(taxableIncomeTax);

    // 住民税
    const taxableResidentYen = floor1000(toYen(Math.max(0, salaryIncome - socialMan - RESIDENT_BASIC_DEDUCTION_MAN
      - (spouse ? 33 : 0) - hs * 33 - uni * 45)));
    const personalDiffMan = 5 + (spouse ? 5 : 0) + hs * 5 + uni * 18;   // 人的控除の差
    const taxableResidentMan = taxableResidentYen / MANEN;
    const adjustmentMan = taxableResidentMan <= 200
      ? Math.min(personalDiffMan, taxableResidentMan) * 0.05
      : Math.max((personalDiffMan - (taxableResidentMan - 200)) * 0.05, 0.25);
    const residentIncomeTaxYen = Math.max(0, Math.round(taxableResidentMan * 0.10 * MANEN) - Math.round(adjustmentMan * MANEN));

    // 上限の目安 = 住民税所得割額 × 20% ÷ (90% − 所得税率 × 1.021) + 2,000円
    const capYen = residentIncomeTaxYen > 0
      ? floor1000(residentIncomeTaxYen * 0.20 / (0.90 - rate * 1.021) + 2000)
      : 0;
    const donatedYen = Math.max(0, Math.round(donated || 0));
    const remainingYen = capYen - donatedYen;

    return {
      salaryIncomeYen: toYen(salaryIncome),
      socialYen: toYen(socialMan),
      incomeTaxRate: rate,
      residentIncomeTaxYen,
      capYen,
      donatedYen,
      remainingYen,
      overCap: remainingYen < 0,
      noDeduction: residentIncomeTaxYen <= 0,
    };
  }
  function toYen(man) { return man * MANEN; }

  // ---- 楽天ふるさと納税の検索結果へのリンク（「11.」）----

  // 楽天アフィリエイトの ID。まだ発行していないので仮の値。
  // オーナーが楽天アフィリエイトの管理画面で作ったら、ここを差し替える（README の「## データ」参照）。
  const AFFILIATE_ID = 'TODO';

  const GENRE_KEYWORDS = {
    all: 'ふるさと納税',
    rice: 'ふるさと納税 米',
    meat: 'ふるさと納税 肉',
    seafood: 'ふるさと納税 魚介',
    fruit: 'ふるさと納税 果物',
    daily: 'ふるさと納税 日用品',
  };

  // 下限は1,000円単位に切り上げ、上限は切り捨て
  const ceil1000 = (yen) => Math.ceil(yen / 1000) * 1000;

  /**
   * 残り（円）から、金額の帯を作る（「4.」）。1,000円単位に丸めたあと min < max にならない
   * （残りが小さすぎて帯にならない）ものは外す。
   */
  function bands(remainingYen) {
    const raw = [];
    if (remainingYen >= 1000) raw.push({ id: 'one', label: '残りで 1 品', rmin: remainingYen * 0.7, rmax: remainingYen });
    if (remainingYen >= 10000) {
      const half = remainingYen / 2;
      raw.push({ id: 'two', label: '残りを 2 品に分ける', rmin: half * 0.7, rmax: half });
    }
    if (remainingYen >= 12000) raw.push({ id: 'round', label: '1 万円前後を探す', rmin: 8000, rmax: 12000 });
    return raw
      .map((b) => ({ id: b.id, label: b.label, min: ceil1000(b.rmin), max: Math.floor(b.rmax / 1000) * 1000 }))
      .filter((b) => b.min > 0 && b.min < b.max);
  }

  function searchUrl(genre, min, max) {
    const keyword = GENRE_KEYWORDS[genre] || GENRE_KEYWORDS.all;
    return `https://search.rakuten.co.jp/search/event/${encodeURIComponent(keyword)}/?ev=40&min=${min}&max=${max}`;
  }

  /** 楽天アフィリエイトのリンクで包む。affiliateId は差し替え確認用に引数で渡せる（省略時は定数）。 */
  function affiliateLink(url, affiliateId) {
    const id = affiliateId || AFFILIATE_ID;
    const enc = encodeURIComponent(url);
    return `https://hb.afl.rakuten.co.jp/hgc/${id}/?pc=${enc}&m=${enc}`;
  }

  function bandLink(genre, min, max) {
    return affiliateLink(searchUrl(genre, min, max));
  }

  root.Capgift = {
    estimate,
    salaryDeductionMan,
    incomeTaxBasicDeductionMan,
    incomeTaxRate,
    RESIDENT_BASIC_DEDUCTION_MAN,
    AFFILIATE_ID,
    GENRE_KEYWORDS,
    bands,
    searchUrl,
    affiliateLink,
    bandLink,
  };
})(typeof window !== 'undefined' ? window : globalThis);
