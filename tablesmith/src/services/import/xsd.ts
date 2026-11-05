import { XMLParser } from 'fast-xml-parser';
import type { SheetData } from '../../types';
import { ImportError } from './types';

function cleanTagName(name: string): string {
  const parts = name.split(':');
  return parts.length > 1 ? parts[1] : name;
}

/**
 * Specialized enterprise parser for XML Schema Definition (.xsd) files.
 * Extracts structured sheets: Elements, Attributes, SimpleTypes, Constraints, and SchemaSummary.
 */
function extractSheetsFromXsd(parsed: Record<string, unknown>): SheetData[] {
  const schemaKey = Object.keys(parsed).find((k) => cleanTagName(k) === 'schema') || 'schema';
  const schema = (parsed[schemaKey] as Record<string, unknown>) || parsed;

  const elementsList: Record<string, string>[] = [];
  const attributesList: Record<string, string>[] = [];
  const simpleTypesList: Record<string, string>[] = [];
  const constraintsList: Record<string, string>[] = [];
  const schemaInfoList: Record<string, string>[] = [];

  // 1. Schema Info
  for (const [k, v] of Object.entries(schema)) {
    if (typeof v === 'string' || typeof v === 'number') {
      schemaInfoList.push({
        '属性名': cleanTagName(k),
        '属性值': String(v),
      });
    }
  }

  const toArray = (item: unknown): unknown[] => {
    if (!item) return [];
    return Array.isArray(item) ? item : [item];
  };

  // 2. SimpleTypes & Enumerations
  const simpleTypeNodes = toArray(schema['xs:simpleType'] || schema['simpleType']);
  for (const st of simpleTypeNodes) {
    if (typeof st !== 'object' || !st) continue;
    const stObj = st as Record<string, unknown>;
    const name = String(stObj['name'] || stObj['@_name'] || '');
    const restriction = (stObj['xs:restriction'] || stObj['restriction']) as Record<string, unknown> | undefined;
    const baseType = restriction ? String(restriction['base'] || restriction['@_base'] || '') : '';
    const enumNodes = restriction ? toArray(restriction['xs:enumeration'] || restriction['enumeration']) : [];
    const enumVals = enumNodes
      .map((en) =>
        en && typeof en === 'object'
          ? String((en as Record<string, unknown>)['value'] || (en as Record<string, unknown>)['@_value'] || '')
          : '',
      )
      .filter(Boolean);

    simpleTypesList.push({
      '类型名称': name,
      '基础数据类型': cleanTagName(baseType),
      '枚举候选值': enumVals.join(' | '),
    });
  }

  // 3. Elements, Attributes, Constraints
  function scanNode(node: unknown, parentScope: string) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child) => scanNode(child, parentScope));
      return;
    }

    const obj = node as Record<string, unknown>;
    const elemName = String(obj['name'] || obj['@_name'] || '');
    const isElement = 'name' in obj && ('type' in obj || 'xs:complexType' in obj || 'complexType' in obj);

    let nextScope = parentScope;
    if (isElement && elemName) {
      nextScope = elemName;
      elementsList.push({
        '元素名称': elemName,
        '所属父节点': parentScope,
        '数据类型': cleanTagName(String(obj['type'] || obj['@_type'] || 'complexType')),
        '最小出现': String(obj['minOccurs'] || obj['@_minOccurs'] || '1'),
        '最大出现': String(obj['maxOccurs'] || obj['@_maxOccurs'] || '1'),
      });
    }

    const attrNodes = toArray(obj['xs:attribute'] || obj['attribute']);
    for (const at of attrNodes) {
      if (typeof at !== 'object' || !at) continue;
      const atObj = at as Record<string, unknown>;
      const atName = String(atObj['name'] || atObj['@_name'] || '');
      if (atName) {
        attributesList.push({
          '属性名称': atName,
          '所属元素': nextScope,
          '数据类型': cleanTagName(String(atObj['type'] || atObj['@_type'] || 'string')),
          '约束 (Use)': String(atObj['use'] || atObj['@_use'] || 'optional'),
          '默认值': String(atObj['default'] || atObj['@_default'] || ''),
        });
      }
    }

    const keyNodes = toArray(obj['xs:key'] || obj['key']);
    for (const kn of keyNodes) {
      if (typeof kn !== 'object' || !kn) continue;
      const knObj = kn as Record<string, unknown>;
      const kName = String(knObj['name'] || knObj['@_name'] || '');
      const selector = (knObj['xs:selector'] || knObj['selector']) as Record<string, unknown> | undefined;
      const field = (knObj['xs:field'] || knObj['field']) as Record<string, unknown> | undefined;
      constraintsList.push({
        '约束名称': kName,
        '约束类型': '主键 (Key)',
        '目标选择器 (Selector)': String(selector?.['xpath'] || selector?.['@_xpath'] || ''),
        '对应字段 (Field)': String(field?.['xpath'] || field?.['@_xpath'] || ''),
        '引用主键 (Refer)': '',
      });
    }

    const keyrefNodes = toArray(obj['xs:keyref'] || obj['keyref']);
    for (const kr of keyrefNodes) {
      if (typeof kr !== 'object' || !kr) continue;
      const krObj = kr as Record<string, unknown>;
      const krName = String(krObj['name'] || krObj['@_name'] || '');
      const refer = String(krObj['refer'] || krObj['@_refer'] || '');
      const selector = (krObj['xs:selector'] || krObj['selector']) as Record<string, unknown> | undefined;
      const field = (krObj['xs:field'] || krObj['field']) as Record<string, unknown> | undefined;
      constraintsList.push({
        '约束名称': krName,
        '约束类型': '外键 (KeyRef)',
        '目标选择器 (Selector)': String(selector?.['xpath'] || selector?.['@_xpath'] || ''),
        '对应字段 (Field)': String(field?.['xpath'] || field?.['@_xpath'] || ''),
        '引用主键 (Refer)': refer,
      });
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('?') || k.startsWith('@_')) continue;
      if (typeof v === 'object' && v !== null) {
        scanNode(v, nextScope);
      }
    }
  }

  scanNode(schema, 'Root');

  const sheets: SheetData[] = [];

  if (elementsList.length > 0) {
    const headers = ['元素名称', '所属父节点', '数据类型', '最小出现', '最大出现'];
    const rows = elementsList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Elements (元素结构)', headers, rows });
  }

  if (attributesList.length > 0) {
    const headers = ['属性名称', '所属元素', '数据类型', '约束 (Use)', '默认值'];
    const rows = attributesList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Attributes (字段属性)', headers, rows });
  }

  if (simpleTypesList.length > 0) {
    const headers = ['类型名称', '基础数据类型', '枚举候选值'];
    const rows = simpleTypesList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'SimpleTypes (枚举与类型)', headers, rows });
  }

  if (constraintsList.length > 0) {
    const headers = ['约束名称', '约束类型', '目标选择器 (Selector)', '对应字段 (Field)', '引用主键 (Refer)'];
    const rows = constraintsList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'Constraints (主外键约束)', headers, rows });
  }

  if (schemaInfoList.length > 0) {
    const headers = ['属性名', '属性值'];
    const rows = schemaInfoList.map((r) => headers.map((h) => r[h] || ''));
    sheets.push({ name: 'SchemaSummary (元信息)', headers, rows });
  }

  return sheets;
}

export function xsdToSheets(text: string): SheetData[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new ImportError(`XSD 格式错误：${err instanceof Error ? err.message : String(err)}`);
  }
  const sheets = extractSheetsFromXsd(parsed);
  if (sheets.length === 0) throw new ImportError('XSD 中没有找到元素、属性或类型定义');
  return sheets;
}
