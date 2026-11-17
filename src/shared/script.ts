// Script detection helpers shared by the content script and the engines.

const HAN_CLASS =
  '\\u3005\\u3007\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\u{20000}-\\u{2FA1F}\\u{30000}-\\u{323AF}';
const KANA_CLASS = '\\u3041-\\u3096\\u309D-\\u309F\\u30A1-\\u30FA\\u30FC-\\u30FF';
const HANGUL_CLASS = '\\uAC00-\\uD7A3';

const HAN = new RegExp(`[${HAN_CLASS}]`, 'u');
const KANA = new RegExp(`[${KANA_CLASS}]`, 'u');
const HANGUL = new RegExp(`[${HANGUL_CLASS}]`, 'u');
const ANY = new RegExp(`[${HAN_CLASS}${KANA_CLASS}${HANGUL_CLASS}]`, 'u');

export const hasHan = (s: string) => HAN.test(s);
export const hasKana = (s: string) => KANA.test(s);
export const hasHangul = (s: string) => HANGUL.test(s);
export const hasCjk = (s: string) => ANY.test(s);

/** Matches each run of hangul syllables (one Korean word, roughly). */
export const hangulRuns = () => new RegExp(`[${HANGUL_CLASS}]+`, 'gu');

const HAN_G = new RegExp(`[${HAN_CLASS}]`, 'gu');
const KANA_G = new RegExp(`[${KANA_CLASS}]`, 'gu');

// Characters that settle the Chinese-or-Japanese question on their own, because
// the other language writes them differently or not at all. These lists only
// need to be precise, not complete: text without any of them falls back to
// context.

/** Simplified forms and everyday Chinese words that Japanese does not use. */
export const CHINESE_ONLY = new RegExp(
  '[' +
    '这们个时说为对发么还经过现样开关问间无长进动种见门东车书话语请谢谁让给从两难题银钱饭馆员买卖觉认识讲读写听汉电脑网页岁师习亲爱欢乐飞场业产资华' +
    '专义乌仅价众优伤传儿兴农军决况则刚创别办务劳势协单历压厂县变响园围图团圣坏块备处复头夺奋妇妈孙宁实审宽导层岛币带帮广库应张强归录忆态总惊惯战护报拥择损显术权' +
    '极标树档桥检气汇沟泽济测满灭灵热爷环玛监盖确离积稳笔签简类纪约级纸线组细终结绝统维继续绿罗联胜节获营蓝虽补视观规览记许论设访证评词试该详课调谈' +
    '负贵费贸质赛赶轻较输边达运远违连选递遗邮释钟错镇闻队阳际陆险隐须领频颜风马验鱼鸟齐龙' +
    '你她吗呢吧啊哪很您它咱啥嘛哦嗯喂哎呀啦妳嗎們這麼沒說裡哥爸媽給' +
    // Traditional forms that Japanese replaced with its own simplifications.
    '學會來對發關變體氣讀圖樂賣實驗險檢權縣總鐵轉傳續單團彈遲廳聽惱腦邊滿藥譯搖樣覽兩獵淚靈齡勞錄營驅繼輕劍嚴顯礦濟劑雜贊齒釋從獸縱處獎燒繩讓釀攝專戰纖錢騷臟帶擇價繪壞懷擴覺歡勸歸犧戲據舉鄉曉經雞擊儉棧兒' +
    ']',
  'u',
);

/** Japanese simplifications and Japan-made characters that Chinese does not use. */
export const JAPANESE_ONLY = new RegExp(
  '[' +
    '気読広図駅楽円売働込峠畑桜実対関発変験険検権県総鉄転伝続単団弾遅庁聴徳悩脳拝髪抜浜仏辺歩毎満黙薬訳揺様頼覧竜両猟緑涙霊齢労録営栄駆恵継軽剣圏厳顕効鉱済砕剤雑賛歯釈収従渋獣縦処奨焼' +
    '乗剰壌嬢浄畳縄譲醸粋酔髄瀬斉摂専戦繊銭捜挿巣騒増臓蔵帯滝択沢価仮絵壊懐拡覚歓勧帰犠戯拠挙郷暁経渓鶏撃倹黒斎桟児舎粛渉々' +
    ']',
  'u',
);

/** Japanese prose this long always contains kana, so kana-free text must be Chinese. */
const LONG_ENOUGH = 12;

/**
 * Decides how the Han characters in `text` should be read, or returns null
 * when the text alone does not say (a short kanji-only word such as 日本 is
 * valid in both languages).
 */
export function guessHanLanguage(text: string): 'zh' | 'ja' | null {
  const kana = text.match(KANA_G)?.length ?? 0;
  const han = text.match(HAN_G)?.length ?? 0;
  // Japanese prose is mostly kana; a stray kana in Chinese text (の in a shop
  // name) should not flip the whole passage.
  if (kana > 0 && kana / (kana + han) > 0.1) return 'ja';
  if (CHINESE_ONLY.test(text)) return 'zh';
  if (JAPANESE_ONLY.test(text)) return 'ja';
  if (han >= LONG_ENOUGH) return 'zh';
  return null;
}

/** Katakana → hiragana, leaving everything else (including ー) untouched. */
export function toHiragana(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out += c >= 0x30a1 && c <= 0x30f6 ? String.fromCharCode(c - 0x60) : ch;
  }
  return out;
}

/** Joins neighbouring un-annotated segments so the output stays compact. */
export function compact<T extends { t: string; r?: string }>(segments: T[]): T[] {
  const out: T[] = [];
  for (const seg of segments) {
    if (!seg.t) continue;
    const last = out[out.length - 1];
    if (last && last.r === undefined && seg.r === undefined) last.t += seg.t;
    else out.push({ ...seg });
  }
  return out;
}
