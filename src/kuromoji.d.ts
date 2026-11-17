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

// kuromoji's internals, used directly so the dictionary can come from Cache
// Storage instead of the URL-based loader the package ships with.
declare module 'kuromoji/src/dict/DynamicDictionaries' {
  export default class DynamicDictionaries {
    loadTrie(base: Int32Array, check: Int32Array): this;
    loadTokenInfoDictionaries(tokenInfo: Uint8Array, pos: Uint8Array, targetMap: Uint8Array): this;
    loadConnectionCosts(costs: Int16Array): this;
    loadUnknownDictionaries(
      unk: Uint8Array,
      unkPos: Uint8Array,
      unkMap: Uint8Array,
      charMap: Uint8Array,
      compatMap: Uint32Array,
      invokeDef: Uint8Array,
    ): this;
  }
}

declare module 'kuromoji/src/Tokenizer' {
  import type DynamicDictionaries from 'kuromoji/src/dict/DynamicDictionaries';
  import type { Token } from './engines/japanese';
  export default class Tokenizer {
    constructor(dictionaries: DynamicDictionaries);
    tokenize(text: string): Token[];
  }
}
