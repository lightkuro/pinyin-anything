// Built as its own file so the Cantonese data is only loaded by the worker
// when Cantonese is actually used.
import ToJyutping from 'to-jyutping';

(self as unknown as { ToJyutping: typeof ToJyutping }).ToJyutping = ToJyutping;
