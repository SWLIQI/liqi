// 统一的文件读取与中文报错：坏 JSON / 缺文件不抛栈。
import fs from 'node:fs';

export function readJson(file, label) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error('ERROR: 读不了 ' + label + '：' + e.message);
    process.exit(1);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('ERROR: ' + label + ' 不是合法 JSON：' + e.message);
    process.exit(1);
  }
}

export function readText(file, label) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.error('ERROR: 读不了 ' + label + '：' + e.message);
    process.exit(1);
  }
}
