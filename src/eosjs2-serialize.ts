// copyright defined in eosjs2/LICENSE.txt

'use strict';

import { Abi, BlockTaposInfo } from './eosjs2-jsonrpc';
import * as numeric from './eosjs2-numeric';

export interface Field {
  name: string;
  typeName: string;
  type: Type;
}

export interface Type {
  name: string;
  aliasOfName: string;
  arrayOf: Type;
  optionalOf: Type;
  baseName: string;
  base: Type;
  fields: Field[];
  serialize: (buffer: SerialBuffer, data: any) => void;
  deserialize: (buffer: SerialBuffer) => any;
}

export interface Symbol {
  name: string;
  precision: number;
}

export interface Contract {
  actions: Map<string, Type>;
  types: Map<string, Type>;
}

export interface Authorization {
  actor: string;
  permission: string;
}

export interface Action {
  account: string;
  name: string;
  authorization: Authorization[];
  data: any;
}

export interface SerializedAction {
  account: string;
  name: string;
  authorization: Authorization[];
  data: string;
}

export class SerialBuffer {
  length = 0;
  array = new Uint8Array(1024);
  readPos = 0;
  textEncoder: TextEncoder;
  textDecoder: TextDecoder;

  constructor({ textEncoder, textDecoder } = {} as { textEncoder: TextEncoder, textDecoder: TextDecoder }) {
    this.textEncoder = textEncoder || new TextEncoder;
    this.textDecoder = textDecoder || new TextDecoder('utf-8', { fatal: true });
  }

  reserve(size: number) {
    if (this.length + size <= this.array.length)
      return;
    let l = this.array.length;
    while (this.length + size > l)
      l = Math.ceil(l * 1.5);
    let newArray = new Uint8Array(l);
    newArray.set(this.array);
    this.array = newArray;
  }

  asUint8Array() {
    return new Uint8Array(this.array.buffer, 0, this.length);
  }

  pushArray(v: number[] | Uint8Array) {
    this.reserve(v.length);
    this.array.set(v, this.length);
    this.length += v.length;
  }

  push(...v: number[]) {
    this.pushArray(v);
  }

  get() {
    if (this.readPos < this.length)
      return this.array[this.readPos++];
    throw new Error('Read past end of buffer');
  }

  pushUint8ArrayChecked(v: Uint8Array, len: number) {
    if (v.length !== len)
      throw new Error('Binary data has incorrect size');
    this.pushArray(v);
  }

  getUint8Array(len: number) {
    if (this.readPos + len > this.length)
      throw new Error('Read past end of buffer');
    let result = new Uint8Array(this.array.buffer, this.readPos, len);
    this.readPos += len;
    return result;
  }

  pushUint16(v: number) {
    this.push((v >> 0) & 0xff, (v >> 8) & 0xff);
  }

  getUint16() {
    let v = 0;
    v |= this.get() << 0;
    v |= this.get() << 8;
    return v;
  }

  pushUint32(v: number) {
    this.push((v >> 0) & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  }

  getUint32() {
    let v = 0;
    v |= this.get() << 0;
    v |= this.get() << 8;
    v |= this.get() << 16;
    v |= this.get() << 24;
    return v >>> 0;
  }

  pushNumberAsUint64(v: number) {
    this.pushUint32(v >>> 0);
    this.pushUint32(Math.floor(v / 0x10000_0000) >>> 0);
  }

  getUint64AsNumber() {
    let low = this.getUint32();
    let high = this.getUint32();
    return (high >>> 0) * 0x10000_0000 + (low >>> 0);
  }

  pushVaruint32(v: number) {
    while (true) {
      if (v >>> 7) {
        this.push(0x80 | (v & 0x7f));
        v = v >>> 7;
      } else {
        this.push(v);
        break;
      }
    }
  }

  getVaruint32() {
    let v = 0;
    let bit = 0;
    while (true) {
      let b = this.get();
      v |= (b & 0x7f) << bit;
      bit += 7;
      if (!(b & 0x80))
        break;
    }
    return v >>> 0;
  }

  pushVarint32(v: number) {
    this.pushVaruint32((v << 1) ^ (v >> 31));
  }

  getVarint32() {
    let v = this.getVaruint32();
    if (v & 1)
      return ((~v) >> 1) | 0x8000_0000;
    else
      return v >>> 1;
  }

  pushFloat32(v: number) {
    this.pushArray(new Uint8Array((new Float32Array([v])).buffer));
  }

  getFloat32() {
    return new Float32Array(this.getUint8Array(4).slice().buffer)[0];
  }

  pushFloat64(v: number) {
    this.pushArray(new Uint8Array((new Float64Array([v])).buffer));
  }

  getFloat64() {
    return new Float64Array(this.getUint8Array(8).slice().buffer)[0];
  }

  pushName(s: string) {
    function charToSymbol(c: number) {
      if (c >= 'a'.charCodeAt(0) && c <= 'z'.charCodeAt(0))
        return (c - 'a'.charCodeAt(0)) + 6;
      if (c >= '1'.charCodeAt(0) && c <= '5'.charCodeAt(0))
        return (c - '1'.charCodeAt(0)) + 1;
      return 0;
    }
    let a = new Uint8Array(8);
    let bit = 63;
    for (let i = 0; i < s.length; ++i) {
      let c = charToSymbol(s.charCodeAt(i));
      if (bit < 5)
        c = c << 1;
      for (let j = 4; j >= 0; --j) {
        if (bit >= 0) {
          a[Math.floor(bit / 8)] |= ((c >> j) & 1) << (bit % 8);
          --bit;
        }
      }
    }
    this.pushArray(a);
  }

  getName() {
    let a = this.getUint8Array(8);
    let result = '';
    for (let bit = 63; bit >= 0;) {
      let c = 0;
      for (let i = 0; i < 5; ++i) {
        if (bit >= 0) {
          c = (c << 1) | ((a[Math.floor(bit / 8)] >> (bit % 8)) & 1);
          --bit;
        }
      }
      if (c >= 6)
        result += String.fromCharCode(c + 'a'.charCodeAt(0) - 6);
      else if (c >= 1)
        result += String.fromCharCode(c + '1'.charCodeAt(0) - 1);
      else
        result += '.';
    }
    if (result === '.............')
      return result;
    while (result.endsWith('.'))
      result = result.substr(0, result.length - 1);
    return result;
  }

  pushBytes(v: number[] | Uint8Array) {
    this.pushVaruint32(v.length);
    this.pushArray(v);
  }

  getBytes() {
    return this.getUint8Array(this.getVaruint32());
  }

  pushString(v: string) {
    this.pushBytes(this.textEncoder.encode(v));
  }

  getString() {
    return this.textDecoder.decode(this.getBytes());
  }

  pushSymbolCode(name: string) {
    let a = [];
    a.push(...this.textEncoder.encode(name));
    while (a.length < 8)
      a.push(0);
    this.pushArray(a.slice(0, 8));
  }

  getSymbolCode() {
    let a = this.getUint8Array(8);
    let len;
    for (len = 0; len < a.length; ++len)
      if (!a[len])
        break;
    let name = this.textDecoder.decode(new Uint8Array(a.buffer, a.byteOffset, len));
    return name;
  }

  pushSymbol({ name, precision }: Symbol) {
    let a = [precision & 0xff];
    a.push(...this.textEncoder.encode(name));
    while (a.length < 8)
      a.push(0);
    this.pushArray(a.slice(0, 8));
  }

  getSymbol(): Symbol {
    let precision = this.get();
    let a = this.getUint8Array(7);
    let len;
    for (len = 0; len < a.length; ++len)
      if (!a[len])
        break;
    let name = this.textDecoder.decode(new Uint8Array(a.buffer, a.byteOffset, len));
    return { name, precision };
  }

  pushAsset(s: string) {
    s = s.trim();
    let pos = 0;
    let amount = '';
    let precision = 0;
    if (s[pos] === '-') {
      amount += '-';
      ++pos;
    }
    let foundDigit = false;
    while (pos < s.length && s.charCodeAt(pos) >= '0'.charCodeAt(0) && s.charCodeAt(pos) <= '9'.charCodeAt(0)) {
      foundDigit = true;
      amount += s[pos];
      ++pos;
    }
    if (!foundDigit)
      throw new Error('Asset must begin with a number');
    if (s[pos] === '.') {
      ++pos;
      while (pos < s.length && s.charCodeAt(pos) >= '0'.charCodeAt(0) && s.charCodeAt(pos) <= '9'.charCodeAt(0)) {
        amount += s[pos];
        ++precision;
        ++pos;
      }
    }
    let name = s.substr(pos).trim();
    this.pushArray(numeric.signedDecimalToBinary(8, amount));
    this.pushSymbol({ name, precision });
  }

  getAsset() {
    let amount = this.getUint8Array(8);
    let { name, precision } = this.getSymbol();
    let s = numeric.signedBinaryToDecimal(amount, precision + 1);
    if (precision)
      s = s.substr(0, s.length - precision) + '.' + s.substr(s.length - precision);
    return s + ' ' + name;
  }

  pushPublicKey(s: string) {
    let key = numeric.stringToPublicKey(s);
    this.push(key.type);
    this.pushArray(key.data);
  }

  getPublicKey() {
    let type = this.get();
    let data = this.getUint8Array(numeric.publicKeyDataSize);
    return numeric.publicKeyToString({ type, data });
  }

  pushPrivateKey(s: string) {
    let key = numeric.stringToPrivateKey(s);
    this.push(key.type);
    this.pushArray(key.data);
  }

  getPrivateKey() {
    let type = this.get();
    let data = this.getUint8Array(numeric.privateKeyDataSize);
    return numeric.privateKeyToString({ type, data });
  }

  pushSignature(s: string) {
    let key = numeric.stringToSignature(s);
    this.push(key.type);
    this.pushArray(key.data);
  }

  getSignature() {
    let type = this.get();
    let data = this.getUint8Array(numeric.signatureDataSize);
    return numeric.signatureToString({ type, data });
  }
} // SerialBuffer

export function dateToTimePoint(date: string) {
  return Math.round(Date.parse(date + 'Z') * 1000);
}

export function timePointToDate(us: number) {
  let s = (new Date(us / 1000)).toISOString();
  return s.substr(0, s.length - 1);
}

export function dateToTimePointSec(date: string) {
  return Math.round(Date.parse(date + 'Z') / 1000);
}

export function timePointSecToDate(sec: number) {
  let s = (new Date(sec * 1000)).toISOString();
  return s.substr(0, s.length - 1);
}

export function dateToBlockTimestamp(date: string) {
  return Math.round((Date.parse(date + 'Z') - 946684800000) / 500);
}

export function blockTimestampToDate(slot: number) {
  let s = (new Date(slot * 500 + 946684800000)).toISOString();
  return s.substr(0, s.length - 1);
}

export function stringToSymbol(s: string): Symbol {
  let m = s.match(/^([0-9]+),([A-Z]+)$/);
  if (!m)
    throw new Error('Invalid symbol');
  return { name: m[2], precision: +m[1] };
}

export function symbolToString({ name, precision }: Symbol) {
  return precision + ',' + name;
}

export function arrayToHex(data: Uint8Array) {
  let result = '';
  for (let x of data)
    result += ('00' + x.toString(16)).slice(-2);
  return result.toUpperCase();
}

export function hexToUint8Array(hex: string) {
  let l = hex.length / 2;
  let result = new Uint8Array(l);
  for (let i = 0; i < l; ++i)
    result[i] = parseInt(hex.substr(i * 2, 2), 16);
  return result;
}

function serializeUnknown(buffer: SerialBuffer, data: any): SerialBuffer {
  throw new Error("Don't know how to serialize " + this.name);
}

function deserializeUnknown(buffer: SerialBuffer): SerialBuffer {
  throw new Error("Don't know how to deserialize " + this.name);
}

function serializeStruct(buffer: SerialBuffer, data: any) {
  if (this.base)
    this.base.serialize(buffer, data);
  for (let field of this.fields) {
    if (!(field.name in data))
      throw new Error('missing ' + this.name + '.' + field.name + ' (type=' + field.type.name + ')');
    field.type.serialize(buffer, data[field.name]);
  }
}

function deserializeStruct(buffer: SerialBuffer) {
  let result;
  if (this.base)
    result = this.base.deserialize(buffer);
  else
    result = {};
  for (let field of this.fields)
    result[field.name] = field.type.deserialize(buffer);
  return result;
}

function serializeArray(buffer: SerialBuffer, data: any[]) {
  buffer.pushVaruint32(data.length);
  for (let item of data)
    this.arrayOf.serialize(buffer, item);
}

function deserializeArray(buffer: SerialBuffer) {
  let len = buffer.getVaruint32();
  let result = [];
  for (let i = 0; i < len; ++i)
    result.push(this.arrayOf.deserialize(buffer));
  return result;
}

function serializeOptional(buffer: SerialBuffer, data: any) {
  if (data === null || data === undefined) {
    buffer.push(0);
  } else {
    buffer.push(1);
    this.optionalOf.serialize(buffer, data);
  }
}

function deserializeOptional(buffer: SerialBuffer) {
  if (buffer.get())
    return this.optionalOf.deserialize(buffer);
  else
    return null;
}

interface CreateTypeArgs {
  name?: string;
  aliasOfName?: string;
  arrayOf?: Type;
  optionalOf?: Type;
  baseName?: string;
  base?: Type;
  fields?: Field[];
  serialize?: (buffer: SerialBuffer, data: any) => void;
  deserialize?: (buffer: SerialBuffer) => any;
}

function createType(attrs: CreateTypeArgs): Type {
  return {
    name: '<missing name>',
    aliasOfName: '',
    arrayOf: null,
    optionalOf: null,
    baseName: '',
    base: null,
    fields: [],
    serialize: serializeUnknown,
    deserialize: deserializeUnknown,
    ...attrs
  };
}

export function createInitialTypes(): Map<string, Type> {
  let result = new Map(Object.entries({
    bool: createType({
      name: 'bool',
      serialize(buffer: SerialBuffer, data: boolean) { buffer.push(data ? 1 : 0); },
      deserialize(buffer: SerialBuffer) { return !!buffer.get(); },
    }),
    uint8: createType({
      name: 'uint8',
      serialize(buffer: SerialBuffer, data: number) { buffer.push(data); },
      deserialize(buffer: SerialBuffer) { return buffer.get(); },
    }),
    int8: createType({
      name: 'int8',
      serialize(buffer: SerialBuffer, data: number) { buffer.push(data); },
      deserialize(buffer: SerialBuffer) { return buffer.get() << 24 >> 24; },
    }),
    uint16: createType({
      name: 'uint16',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushUint16(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getUint16(); },
    }),
    int16: createType({
      name: 'int16',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushUint16(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getUint16() << 16 >> 16; },
    }),
    uint32: createType({
      name: 'uint32',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushUint32(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getUint32(); },
    }),
    uint64: createType({
      name: 'uint64',
      serialize(buffer: SerialBuffer, data: string | number) { buffer.pushArray(numeric.decimalToBinary(8, '' + data)); },
      deserialize(buffer: SerialBuffer) { return numeric.binaryToDecimal(buffer.getUint8Array(8)); },
    }),
    int64: createType({
      name: 'int64',
      serialize(buffer: SerialBuffer, data: string | number) { buffer.pushArray(numeric.signedDecimalToBinary(8, '' + data)); },
      deserialize(buffer: SerialBuffer) { return numeric.signedBinaryToDecimal(buffer.getUint8Array(8)); },
    }),
    int32: createType({
      name: 'int32',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushUint32(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getUint32() | 0; },
    }),
    varuint32: createType({
      name: 'varuint32',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushVaruint32(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getVaruint32(); },
    }),
    varint32: createType({
      name: 'varint32',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushVarint32(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getVarint32(); },
    }),
    uint128: createType({
      name: 'uint128',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushArray(numeric.decimalToBinary(16, data)); },
      deserialize(buffer: SerialBuffer) { return numeric.binaryToDecimal(buffer.getUint8Array(16)); },
    }),
    int128: createType({
      name: 'int128',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushArray(numeric.signedDecimalToBinary(16, data)); },
      deserialize(buffer: SerialBuffer) { return numeric.signedBinaryToDecimal(buffer.getUint8Array(16)); },
    }),
    float32: createType({
      name: 'float32',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushFloat32(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getFloat32(); },
    }),
    float64: createType({
      name: 'float64',
      serialize(buffer: SerialBuffer, data: number) { buffer.pushFloat64(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getFloat64(); },
    }),
    float128: createType({
      name: 'float128',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushUint8ArrayChecked(hexToUint8Array(data), 16); },
      deserialize(buffer: SerialBuffer) { return arrayToHex(buffer.getUint8Array(16)); },
    }),

    bytes: createType({
      name: 'bytes',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushBytes(hexToUint8Array(data)); },
      deserialize(buffer: SerialBuffer) { return arrayToHex(buffer.getBytes()); },
    }),
    string: createType({
      name: 'string',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushString(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getString(); },
    }),
    name: createType({
      name: 'name',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushName(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getName(); },
    }),
    time_point: createType({
      name: 'time_point',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushNumberAsUint64(dateToTimePoint(data)); },
      deserialize(buffer: SerialBuffer) { return timePointToDate(buffer.getUint64AsNumber()); },
    }),
    time_point_sec: createType({
      name: 'time_point_sec',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushUint32(dateToTimePointSec(data)); },
      deserialize(buffer: SerialBuffer) { return timePointSecToDate(buffer.getUint32()); },
    }),
    block_timestamp_type: createType({
      name: 'block_timestamp_type',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushUint32(dateToBlockTimestamp(data)); },
      deserialize(buffer: SerialBuffer) { return blockTimestampToDate(buffer.getUint32()); },
    }),
    symbol_code: createType({
      name: 'symbol_code',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushSymbolCode(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getSymbolCode(); },
    }),
    symbol: createType({
      name: 'symbol',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushSymbol(stringToSymbol(data)); },
      deserialize(buffer: SerialBuffer) { return symbolToString(buffer.getSymbol()); },
    }),
    asset: createType({
      name: 'asset',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushAsset(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getAsset(); },
    }),
    checksum160: createType({
      name: 'checksum160',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushUint8ArrayChecked(hexToUint8Array(data), 20); },
      deserialize(buffer: SerialBuffer) { return arrayToHex(buffer.getUint8Array(20)); },
    }),
    checksum256: createType({
      name: 'checksum256',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushUint8ArrayChecked(hexToUint8Array(data), 32); },
      deserialize(buffer: SerialBuffer) { return arrayToHex(buffer.getUint8Array(32)); },
    }),
    checksum512: createType({
      name: 'checksum512',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushUint8ArrayChecked(hexToUint8Array(data), 64); },
      deserialize(buffer: SerialBuffer) { return arrayToHex(buffer.getUint8Array(64)); },
    }),
    public_key: createType({
      name: 'public_key',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushPublicKey(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getPublicKey(); },
    }),
    private_key: createType({
      name: 'private_key',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushPrivateKey(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getPrivateKey(); },
    }),
    signature: createType({
      name: 'signature',
      serialize(buffer: SerialBuffer, data: string) { buffer.pushSignature(data); },
      deserialize(buffer: SerialBuffer) { return buffer.getSignature(); },
    }),
  }));

  result.set('extended_asset', createType({
    name: 'extended_asset',
    baseName: '',
    fields: [
      { name: 'quantity', typeName: 'asset', type: result.get('asset') },
      { name: 'contract', typeName: 'name', type: result.get('name') },
    ],
    serialize: serializeStruct,
    deserialize: deserializeStruct,
  }));

  return result;
} // createInitialTypes()

export function getType(types: Map<string, Type>, name: string): Type {
  let type = types.get(name);
  if (type && type.aliasOfName)
    return getType(types, type.aliasOfName);
  if (type)
    return type;
  if (name.endsWith('[]')) {
    return createType({
      name,
      arrayOf: getType(types, name.substr(0, name.length - 2)),
      serialize: serializeArray,
      deserialize: deserializeArray,
    });
  }
  if (name.endsWith('?')) {
    return createType({
      name,
      optionalOf: getType(types, name.substr(0, name.length - 1)),
      serialize: serializeOptional,
      deserialize: deserializeOptional,
    });
  }
  throw new Error('Unknown type: ' + name);
}

export function getTypesFromAbi(initialTypes: Map<string, Type>, abi: Abi) {
  let types = new Map(initialTypes);
  for (let { new_type_name, type } of abi.types)
    types.set(new_type_name,
      createType({ name: new_type_name, aliasOfName: type, }));
  for (let { name, base, fields } of abi.structs) {
    types.set(name, createType({
      name,
      baseName: base,
      fields: fields.map(({ name, type }) => ({ name, typeName: type, type: null })),
      serialize: serializeStruct,
      deserialize: deserializeStruct,
    }));
  }
  for (let [name, type] of types) {
    if (type.baseName)
      type.base = getType(types, type.baseName);
    for (let field of type.fields)
      field.type = getType(types, field.typeName);
  }
  return types;
} // getTypesFromAbi

export function transactionHeader(refBlock: BlockTaposInfo, expireSeconds: number) {
  return {
    expiration: timePointSecToDate(dateToTimePointSec(refBlock.timestamp) + expireSeconds),
    ref_block_num: refBlock.block_num & 0xffff,
    ref_block_prefix: refBlock.ref_block_prefix,
  };
};

export function serializeActionData(contract: Contract, account: string, name: string, data: any, textEncoder: TextEncoder, textDecoder: TextDecoder): string {
  let action = contract.actions.get(name);
  if (!action) {
    throw new Error(`Unknown action ${name} in contract ${account}`);
  }
  let buffer = new SerialBuffer({ textEncoder, textDecoder });
  action.serialize(buffer, data);
  return arrayToHex(buffer.asUint8Array());
}

export function serializeAction(contract: Contract, account: string, name: string, authorization: Authorization[], data: any, textEncoder: TextEncoder, textDecoder: TextDecoder): SerializedAction {
  return {
    account,
    name,
    authorization,
    data: serializeActionData(contract, account, name, data, textEncoder, textDecoder),
  };
}

export function deserializeActionData(contract: Contract, account: string, name: string, data: any, textEncoder: TextEncoder, textDecoder: TextDecoder): any {
  const action = contract.actions.get(name);
  if (typeof data === "string") {
    data = hexToUint8Array(data)
  }
  if (!action) {
    throw new Error(`Unknown action ${name} in contract ${account}`);
  }
  let buffer = new SerialBuffer({ textDecoder, textEncoder });
  buffer.pushArray(data)
  return action.deserialize(buffer);
}

export function deserializeAction(contract: Contract, account: string, name: string, authorization: Authorization[], data: any, textEncoder: TextEncoder, textDecoder: TextDecoder): Action {
  return {
    account,
    name,
    authorization,
    data: deserializeActionData(contract, account, name, data, textEncoder, textDecoder),
  };
}
