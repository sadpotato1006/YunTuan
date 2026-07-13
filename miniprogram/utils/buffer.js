/**
 * 通用二进制转换工具，不包含任何具体硬件协议。
 */

function toUint8Array(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("数据必须是 ArrayBuffer 或 TypedArray");
}

function arrayBufferToHex(value) {
  return Array.from(toUint8Array(value))
    .map(byte => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

function hexToArrayBuffer(input) {
  if (typeof input !== "string") throw new Error("请输入十六进制数据");
  const normalized = input
    .replace(/0x/gi, "")
    .replace(/[\s,;:_-]/g, "")
    .toUpperCase();

  if (!normalized) throw new Error("请输入要写入的数据，例如：03 01");
  if (!/^[0-9A-F]+$/.test(normalized)) throw new Error("十六进制数据只能包含 0-9 和 A-F");
  if (normalized.length % 2 !== 0) throw new Error("每个字节必须由两个十六进制字符组成");

  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes.buffer;
}

function arrayBufferToUtf8(value) {
  const bytes = toUint8Array(value);
  let output = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let codePoint;

    if (first < 0x80) {
      codePoint = first;
    } else if ((first & 0xE0) === 0xC0 && index < bytes.length) {
      codePoint = ((first & 0x1F) << 6) | (bytes[index++] & 0x3F);
    } else if ((first & 0xF0) === 0xE0 && index + 1 < bytes.length) {
      codePoint = ((first & 0x0F) << 12) |
        ((bytes[index++] & 0x3F) << 6) |
        (bytes[index++] & 0x3F);
    } else if ((first & 0xF8) === 0xF0 && index + 2 < bytes.length) {
      codePoint = ((first & 0x07) << 18) |
        ((bytes[index++] & 0x3F) << 12) |
        ((bytes[index++] & 0x3F) << 6) |
        (bytes[index++] & 0x3F);
    } else {
      codePoint = 0xFFFD;
    }

    if (codePoint <= 0xFFFF) {
      output += String.fromCharCode(codePoint);
    } else {
      codePoint -= 0x10000;
      output += String.fromCharCode(0xD800 + (codePoint >> 10));
      output += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
    }
  }
  return output;
}

function toPrintableText(value) {
  const text = arrayBufferToUtf8(value);
  if (!text) return "";
  let printableCount = 0;
  let output = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const printable = code === 9 || code === 10 || code === 13 || code >= 32;
    output += printable ? text[index] : "·";
    if (printable) printableCount += 1;
  }
  return printableCount ? output : "";
}

module.exports = {
  toUint8Array,
  arrayBufferToHex,
  hexToArrayBuffer,
  arrayBufferToUtf8,
  toPrintableText
};
