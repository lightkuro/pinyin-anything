import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import kuromoji from 'kuromoji';
import ToJyutping from 'to-jyutping';
import { beforeAll, describe, expect, it } from 'vitest';
import { annotateCantonese } from '../src/engines/cantonese';
import type { Token } from '../src/engines/japanese';
import { chineseDictionary, type Dictionary, japaneseDictionary, koreanDictionary } from '../src/meanings/dictionary';
import { koreanStems, lookupChinese, lookupJapanese, lookupJapanesePlain, lookupKorean } from '../src/meanings/lookup';
import { numberedToMarks } from '../src/meanings/pinyin';
import type { LookupResult } from '../src/shared/types';

// These run against the real dictionary files the extension downloads.
const load = (language: string) => gunzipSync(readFileSync(`dictionaries/${language}.txt.gz`)).toString('utf8');
const found = (text: string, result: LookupResult | null) => (result ? text.slice(result.start, result.end) : null);
const allSenses = (result: LookupResult | null) => result?.meanings.flatMap((m) => m.senses).join(' | ') ?? '';

describe('pinyin with tone numbers', () => {
  it('becomes pinyin with tone marks', () => {
    expect(numberedToMarks('ni3 hao3')).toBe('nǐ hǎo');
    expect(numberedToMarks('Zhong1 guo2')).toBe('Zhōng guó');
    expect(numberedToMarks('nu:3 ren2')).toBe('nǚ rén');
    expect(numberedToMarks('lu:e4')).toBe('lüè');
    expect(numberedToMarks('xue2 sheng5')).toBe('xué sheng');
    expect(numberedToMarks('liu2 gui4 dui4 you3 jiong3')).toBe('liú guì duì yǒu jiǒng');
    expect(numberedToMarks('E4 luo2 si1')).toBe('È luó sī');
  });

  it('leaves letters and digits that are not syllables alone', () => {
    expect(numberedToMarks('A A zhi4')).toBe('A A zhì');
    expect(numberedToMarks('3 C')).toBe('3 C');
  });
});

describe('Cantonese', () => {
  const jyutping = (text: string, tone: 'symbol' | 'num' | 'none') =>
    annotateCantonese(ToJyutping.getJyutpingList(text), tone);

  it('annotates each character with jyutping', () => {
    expect(jyutping('你好，香港', 'symbol')).toEqual([
      { t: '你', r: 'nei5' },
      { t: '好', r: 'hou2' },
      { t: '，' },
      { t: '香', r: 'hoeng1' },
      { t: '港', r: 'gong2' },
    ]);
  });

  it('can drop the tone numbers and leaves other text alone', () => {
    const segments = jyutping('我哋 OK', 'none');
    expect(segments).toEqual([{ t: '我', r: 'ngo' }, { t: '哋', r: 'dei' }, { t: ' OK' }]);
  });
});

describe('Chinese meanings', () => {
  let dict: Dictionary;
  beforeAll(() => {
    dict = chineseDictionary(load('zh'));
  });

  it('finds the word the pointer is in, whichever character is pointed at', () => {
    const text = '我在中华人民共和国的图书馆学习';
    expect(found(text, lookupChinese(dict, text, 0))).toBe('我');
    expect(found(text, lookupChinese(dict, text, 2))).toBe('中华人民共和国');
    expect(found(text, lookupChinese(dict, text, 8))).toBe('中华人民共和国');
    expect(found(text, lookupChinese(dict, text, 11))).toBe('图书馆');
    expect(found(text, lookupChinese(dict, text, 14))).toBe('学习');
  });

  it('splits neighbouring words the way a reader would', () => {
    const text = '银行行长说：你好';
    expect(found(text, lookupChinese(dict, text, 1))).toBe('银行');
    expect(found(text, lookupChinese(dict, text, 2))).toBe('行长');
    expect(found(text, lookupChinese(dict, text, 7))).toBe('你好');
    expect(lookupChinese(dict, text, 5)).toBeNull(); // punctuation
  });

  it('gives readings with tone marks and the meanings', () => {
    const result = lookupChinese(dict, '你好吗', 0)!;
    expect(result.meanings[0]).toMatchObject({ word: '你好', reading: 'nǐ hǎo' });
    expect(allSenses(result)).toMatch(/hello/i);
  });

  it('leaves out measure-word notation', () => {
    expect(allSenses(lookupChinese(dict, '银行', 0))).toBe('bank');
  });

  it('works for traditional characters and lists every reading, everyday ones first', () => {
    expect(allSenses(lookupChinese(dict, '學習', 0))).toMatch(/to learn|to study/);
    const readings = lookupChinese(dict, '行', 0)!.meanings.map((m) => m.reading);
    expect(readings).toEqual(expect.arrayContaining(['xíng', 'háng']));
    expect(readings.at(-1)).toMatch(/^[A-Z]|^x|^h/);
  });

  it('finds nothing where there is no Chinese', () => {
    expect(lookupChinese(dict, 'hello', 0)).toBeNull();
  });
});

describe('Japanese meanings', () => {
  let dict: Dictionary;
  let tokenize: (text: string) => Token[];
  beforeAll(async () => {
    dict = japaneseDictionary(load('ja'));
    tokenize = await new Promise((resolve, reject) => {
      kuromoji.builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error, tokenizer) => {
        if (error) reject(error);
        else resolve((text) => tokenizer.tokenize(text));
      });
    });
  });
  const at = (text: string, pointAt: string) => lookupJapanese(dict, tokenize(text), text.indexOf(pointAt));

  it('looks up inflected words by their dictionary form', () => {
    const text = '昨日、寿司を食べました。';
    const result = at(text, '食');
    expect(found(text, result)).toBe('食べ');
    expect(result!.meanings[0]).toMatchObject({ word: '食べる', reading: 'たべる' });
    expect(allSenses(result)).toMatch(/to eat/);
  });

  it('joins tokens that form one dictionary word, wherever the pointer is in it', () => {
    const text = '日本語を勉強する';
    expect(found(text, at(text, '日'))).toBe('日本語');
    expect(found(text, at(text, '語'))).toBe('日本語');
    expect(allSenses(at(text, '語'))).toMatch(/Japanese \(language\)/);
  });

  it('explains particles and kana words', () => {
    const text = '私はりんごが好きです';
    expect(at(text, 'は')!.meanings[0].senses.join(' ')).toMatch(/topic/);
    expect(at(text, 'りんご')!.meanings[0]).toMatchObject({ word: 'りんご', reading: '' });
    expect(allSenses(at(text, 'りんご'))).toMatch(/apple/);
  });

  it('ignores punctuation and Latin text', () => {
    expect(at('Hello、世界', 'H')).toBeNull();
    expect(at('Hello、世界', '、')).toBeNull();
  });

  it('still finds uninflected words without the tokenizer', () => {
    const text = '日本語を勉強する';
    expect(found(text, lookupJapanesePlain(dict, text, 0))).toBe('日本語');
    expect(found(text, lookupJapanesePlain(dict, text, 4))).toBe('勉強');
  });
});

describe('Korean meanings', () => {
  let dict: Dictionary;
  beforeAll(() => {
    dict = koreanDictionary(load('ko'));
  });
  const at = (text: string, pointAt: string) => lookupKorean(dict, text, text.indexOf(pointAt));
  const words = (result: LookupResult | null) => result?.meanings.map((m) => m.word.split(' ')[0]) ?? [];

  it('undoes common conjugations', () => {
    expect(koreanStems('갔')).toContain('가');
    expect(koreanStems('했')).toContain('하');
    expect(koreanStems('마셔')).toContain('마시');
    expect(koreanStems('추워')).toContain('춥');
    expect(koreanStems('몰라')).toContain('모르');
    expect(koreanStems('공부합')).toContain('공부하');
  });

  it('strips particles from nouns', () => {
    const text = '저는 한국어를 공부합니다.';
    const result = at(text, '한국어');
    expect(found(text, result)).toBe('한국어');
    expect(allSenses(result)).toMatch(/Korean/);
    expect(result!.meanings[0].reading).toBe('hangugeo');
  });

  it('finds verbs and adjectives from conjugated forms', () => {
    expect(words(at('학교에 갔어요', '갔'))).toContain('가다');
    expect(words(at('물을 마셨어요', '마셨'))).toContain('마시다');
    expect(words(at('밥을 먹었습니다', '먹'))).toContain('먹다');
    expect(words(at('날씨가 추워요', '추'))).toContain('춥다');
    expect(words(at('정말 예뻐요', '예'))).toContain('예쁘다');
    expect(allSenses(at('학교에 갔어요', '갔'))).toMatch(/to go/);
  });

  it('finds a later word inside a compound written without spaces', () => {
    const text = '한국어공부';
    expect(found(text, at(text, '한'))).toBe('한국어');
    expect(found(text, at(text, '공'))).toBe('공부');
  });

  it('finds nothing where there is no Korean', () => {
    expect(lookupKorean(dict, 'hello 中文', 0)).toBeNull();
  });
});
