// Support bigint handle for JSONStrigify
Object.defineProperty(BigInt.prototype, 'toJSON', {
  get() {
    'use strict';
    return () => String(this);
  }
});
