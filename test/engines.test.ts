import kuromoji from 'kuromoji';
import { beforeAll, describe, expect, it } from 'vitest';
import { annotateChinese } from '../src/engines/chinese';
import { annotateJapanese, furigana, type Token } from '../src/engines/japanese';
import { addKorean, annotateKorean } from '../src/engines/korean';
import type { Segment } from '../src/shared/types';

const readings = (segments: Segment[]) => segments.filter((s) => s.r).map((s) => s.r).join(' ');
const original = (segments: Segment[]) => segments.map((s) => s.t).join('');

describe('Chinese', () => {
  it('annotates each character and resolves polyphones from context', () => {
    const segments = annotateChinese('银行行长', 'symbol');
    expect(segments).toEqual([
      { t: '银', r: 'yín' },
      { t: '行', r: 'háng' },
      { t: '行', r: 'háng' },
      { t: '长', r: 'zhǎng' },
    ]);
  });

  it('leaves non-Chinese text alone and preserves the original text', () => {
    const text = '你好, world！ 𠀀 123';
    const segments = annotateChinese(text, 'symbol');
    expect(original(segments)).toBe(text);
    expect(readings(segments)).toBe('nǐ hǎo');
    expect(segments[2]).toEqual({ t: ', world！ 𠀀 123' });
  });

  it('supports tone numbers and no tones', () => {
    expect(readings(annotateChinese('你好', 'num'))).toBe('ni3 hao3');
    expect(readings(annotateChinese('你好', 'none'))).toBe('ni hao');
  });

  it('reads traditional characters', () => {
    expect(readings(annotateChinese('漢語學習', 'symbol'))).toBe('hàn yǔ xué xí');
  });
});

describe('Korean', () => {
  it('romanizes each word with sound changes', () => {
    expect(annotateKorean('안녕하세요, 한국어!')).toEqual([
      { t: '안녕하세요', r: 'annyeonghaseyo' },
      { t: ', ' },
      { t: '한국어', r: 'hangugeo' },
      { t: '!' },
    ]);
  });

  it('only touches segments that are not already annotated', () => {
    const mixed = addKorean([{ t: '中', r: 'zhōng' }, { t: ' 서울 ' }]);
    expect(mixed).toEqual([{ t: '中', r: 'zhōng' }, { t: ' ' }, { t: '서울', r: 'seoul' }, { t: ' ' }]);
  });
});

describe('Japanese', () => {
  let tokenize: (text: string) => Token[];
  beforeAll(async () => {
    tokenize = await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, tokenizer) => {
        if (error) reject(error);
        else resolve((text) => tokenizer.tokenize(text));
      });
    });
  });
  const romaji = (text: string) => annotateJapanese(tokenize(text), 'romaji');
  const hiragana = (text: string) => annotateJapanese(tokenize(text), 'hiragana');

  it('romanizes words and reads particles as they are spoken', () => {
    expect(readings(romaji('東京へ行く'))).toBe('toukyou e iku');
    expect(readings(romaji('私は水を飲む'))).toBe('watashi wa mizu o nomu');
  });

  it('joins verb endings and keeps doubled consonants across tokens', () => {
    expect(romaji('食べました')).toEqual([{ t: '食べました', r: 'tabemashita' }]);
    expect(readings(romaji('学校に行って'))).toBe('gakkou ni itte');
    expect(readings(romaji('学生でした'))).toBe('gakusei deshita');
  });

  it('handles katakana, including words missing from the dictionary', () => {
    expect(readings(romaji('コーヒー'))).toBe('koohii');
    expect(readings(romaji('ポケモンゴー'))).toMatch(/^pokemon ?goo$/);
  });

  it('passes Latin text, digits and punctuation through untouched', () => {
    const text = 'Hello、2024年です。';
    const segments = romaji(text);
    expect(original(segments)).toBe(text);
    expect(readings(segments)).toBe('nen desu');
  });

  it('puts hiragana only over kanji, not okurigana', () => {
    expect(hiragana('食べる')).toEqual([{ t: '食', r: 'た' }, { t: 'べる' }]);
    expect(hiragana('お茶を飲み込む')).toEqual([
      { t: 'お' },
      { t: '茶', r: 'ちゃ' },
      { t: 'を' },
      { t: '飲', r: 'の' },
      { t: 'み' },
      { t: '込', r: 'こ' },
      { t: 'む' },
    ]);
    expect(hiragana('ひらがな')).toEqual([{ t: 'ひらがな' }]);
  });

  it('falls back to the whole word when the reading cannot be aligned', () => {
    expect(furigana('今日は', 'キョウ')).toEqual([{ t: '今日は', r: 'きょう' }]);
  });
});
