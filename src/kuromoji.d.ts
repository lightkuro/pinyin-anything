declare module 'kuromoji' {
  import type { Token } from './engines/japanese';
  interface Tokenizer {
    tokenize(text: string): Token[];
  }
  const kuromoji: {
    builder(options: { dicPath: string }): {
      build(callback: (error: unknown, tokenizer: Tokenizer) => void): void;
    };
  };
  export default kuromoji;
}
