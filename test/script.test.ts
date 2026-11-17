import { describe, expect, it } from 'vitest';
import { CHINESE_ONLY, JAPANESE_ONLY, compact, guessHanLanguage, hasCjk, hasHan, hasHangul, hasKana, toHiragana } from '../src/shared/script';
import { siteKey } from '../src/shared/settings';

describe('script detection', () => {
  it('tells the scripts apart', () => {
    expect(hasHan('漢')).toBe(true);
    expect(hasHan('かな한글abc')).toBe(false);
    expect(hasKana('ひらがな')).toBe(true);
    expect(hasKana('カタカナ')).toBe(true);
    expect(hasKana('中文、。')).toBe(false);
    expect(hasHangul('한글')).toBe(true);
    expect(hasHangul('漢字')).toBe(false);
    expect(hasCjk('Hello, world! 123 ·…')).toBe(false);
    expect(hasCjk('𠀀')).toBe(true);
  });

  it('separates Japanese from Chinese', () => {
    // Prose
    expect(guessHanLanguage('今日はいい天気ですね。散歩に行きましょう。')).toBe('ja');
    expect(guessHanLanguage('今天天气很好，我们去散步吧。')).toBe('zh');
    expect(guessHanLanguage('今天天氣很好，我們去散步吧。')).toBe('zh');
    // Kana-only and kanji-only Japanese
    expect(guessHanLanguage('コーヒー')).toBe('ja');
    expect(guessHanLanguage('東京駅')).toBe('ja');
    expect(guessHanLanguage('営業時間')).toBe('ja');
    // Short Chinese
    expect(guessHanLanguage('银行')).toBe('zh');
    expect(guessHanLanguage('謝謝你')).toBe('zh');
    // A stray kana does not make Chinese text Japanese
    expect(guessHanLanguage('这家店的の字招牌很有名，很多人来这里拍照打卡留念。')).toBe('zh');
    // Long kana-free text is Chinese even without a telltale character
    expect(guessHanLanguage('床前明月光，疑是地上霜。舉頭望明月，低頭思故鄉。')).toBe('zh');
  });

  it('admits when a word could be either language', () => {
    expect(guessHanLanguage('日本')).toBeNull();
    expect(guessHanLanguage('世界')).toBeNull();
    expect(guessHanLanguage('Hello')).toBeNull();
  });

  it('keeps the telltale character lists disjoint', () => {
    // A character in both lists would make the answer depend on check order.
    const chinese = new Set([...CHINESE_ONLY.source].filter((ch) => hasHan(ch)));
    const japanese = new Set([...JAPANESE_ONLY.source].filter((ch) => hasHan(ch)));
    expect([...chinese].filter((ch) => japanese.has(ch))).toEqual([]);
    expect(chinese.size).toBeGreaterThan(300);
    expect(japanese.size).toBeGreaterThan(100);
  });

  it('converts katakana to hiragana', () => {
    expect(toHiragana('トウキョウ')).toBe('とうきょう');
    expect(toHiragana('コーヒー abc 漢')).toBe('こーひー abc 漢');
  });

  it('merges neighbouring plain segments', () => {
    expect(compact([{ t: 'a' }, { t: '' }, { t: 'b' }, { t: '中', r: 'zhōng' }, { t: 'c' }])).toEqual([
      { t: 'ab' },
      { t: '中', r: 'zhōng' },
      { t: 'c' },
    ]);
  });
});

describe('siteKey', () => {
  it('uses the hostname for web pages and one key for local files', () => {
    expect(siteKey('https://zh.wikipedia.org/wiki/中文')).toBe('zh.wikipedia.org');
    expect(siteKey('http://localhost:8080/x')).toBe('localhost');
    expect(siteKey('file:///home/me/page.html')).toBe('file:');
  });

  it('rejects pages extensions cannot run on', () => {
    expect(siteKey('chrome://extensions')).toBeNull();
    expect(siteKey('about:blank')).toBeNull();
    expect(siteKey(undefined)).toBeNull();
    expect(siteKey('not a url')).toBeNull();
  });
});
