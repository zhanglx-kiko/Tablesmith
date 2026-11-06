import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetData } from '../../types';
import { formatNumber, looksDate, looksNumeric } from './cellText';
import { decodeText } from './decode';
import { ImportError, parseClipboardText, parseDesktopPayload, parseFileBytes } from './index';
import { normalizeSheet } from './normalize';
import type { GridCell, RawSheet } from './types';

const FIXTURES = join(__dirname, '../../../sample-data/edge-cases');
const REAL_DATA = 'D:/tmp/excel';

function load(name: string): { sheets: SheetData[]; notices: string[] } {
  const { file, notices } = parseFileBytes(name, new Uint8Array(readFileSync(join(FIXTURES, name))));
  return { sheets: file.sheets, notices };
}

function sheet(sheets: SheetData[], name: string): SheetData {
  const found = sheets.find((s) => s.name === name);
  if (!found) throw new Error(`sheet ${name} not found in ${sheets.map((s) => s.name).join(', ')}`);
  return found;
}

function column(s: SheetData, header: string): string[] {
  const idx = s.headers.indexOf(header);
  expect(idx, `column ${header}`).toBeGreaterThanOrEqual(0);
  return s.rows.map((r) => r[idx]);
}

function raw(cells: GridCell[][], merges: [number, number, number, number][] = []): RawSheet {
  return { name: 'S', hidden: false, origin: [0, 0], cells, merges, uncachedFormulas: 0, formats: [], cellFormats: [] };
}

describe('cell text helpers', () => {
  it('keeps the exact stored double as raw text', () => {
    // Red line: the raw value reads back as the very same double. Excel's 15-digit
    // rendering (0.3) is display-only, see numberFormat.ts.
    expect(formatNumber(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(formatNumber(45351.57326388889)).toBe('45351.57326388889');
    expect(formatNumber(1e-7)).toBe('0.0000001');
    expect(formatNumber(347826898.63)).toBe('347826898.63');
    expect(formatNumber(-0.75)).toBe('-0.75');
    for (let i = 0; i < 20000; i += 1) {
      const v = (Math.random() - 0.5) * 10 ** Math.floor(Math.random() * 40 - 20);
      expect(Number(formatNumber(v))).toBe(v);
    }
  });

  it('separates numbers, dates and labels', () => {
    expect(looksNumeric('1,200.50')).toBe(true);
    expect(looksNumeric('(1,500)')).toBe(true);
    expect(looksNumeric('25%')).toBe(true);
    expect(looksNumeric('2024-01')).toBe(false);
    expect(looksDate('2024-01')).toBe(true);
    expect(looksDate('1234.5')).toBe(false);
    expect(looksDate('2024年1月')).toBe(true);
  });
});

describe('header detection', () => {
  it('skips a banner title and a blank row', () => {
    const [t] = normalizeSheet(raw([['Report title'], [], ['Name', 'Qty'], ['a', 1], ['b', 2]]));
    expect(t.headers).toEqual(['Name', 'Qty']);
    expect(t.rows).toEqual([['a', '1'], ['b', '2']]);
  });

  it('treats a numeric first row as data and names columns by letter', () => {
    const [t] = normalizeSheet(raw([[1, 2], [3, 4]]));
    expect(t.headers).toEqual(['列A', '列B']);
    expect(t.rows).toHaveLength(2);
  });

  it('formats month header dates compactly', () => {
    const [t] = normalizeSheet(raw([['Month', { date: '2024-01-01' }, { date: '2024-02-01' }], ['x', 1, 2]]));
    expect(t.headers).toEqual(['Month', '2024-01', '2024-02']);
  });

  it('splits stacked tables separated by a titled gap', () => {
    const tables = normalizeSheet(
      raw([['A', 'B'], ['x', 1], [], [], ['Second table'], ['C', 'D', 'E'], ['y', 2, 3]]),
    );
    expect(tables.map((t) => t.name)).toEqual(['S', 'S · Second table']);
    expect(tables[1].headers).toEqual(['C', 'D', 'E']);
  });
});

describe('spreadsheet fixtures', () => {
  for (const ext of ['xlsx', 'xls', 'xlsb', 'ods']) {
    it(`reads merged two-level headers and typed cells (.${ext})`, () => {
      const { sheets, notices } = load(`report_layouts.${ext}`);
      const sales = sheet(sheets, '区域销售');
      expect(sales.headers).toEqual(['地区', '城市', '上半年 / Q1', '上半年 / Q2', '下半年 / Q3', '下半年 / Q4']);
      expect(column(sales, '地区')).toEqual(['华东', '华东', '华南', '华南']);
      expect(sales.rows[0][5]).toBe('0.3');
      expect(notices.some((n) => n.includes('数据来源'))).toBe(true);

      const typed = sheet(sheets, '类型样例');
      expect(typed.rows[0].slice(0, 6)).toEqual(['A-001', '2024-01-31', '13:45:00', '2024-02-01 09:30:15', '1234.5', 'TRUE']);
      expect(typed.rows[1][6]).toBe('  前导空格');

      expect(sheet(sheets, '重复表头').headers).toEqual(['名称', '金额', '金额_2', '名称_2']);
    });
  }

  it('reports hidden, empty and uncalculated content', () => {
    const { sheets, notices } = load('report_layouts.xlsx');
    expect(sheets.map((s) => s.name)).not.toContain('空白页');
    expect(sheet(sheets, '隐藏参数').rows).toEqual([['税率', '0.13']]);
    expect(notices.join('\n')).toMatch(/隐藏工作表：隐藏参数/);
    expect(notices.join('\n')).toMatch(/3 个公式单元格没有保存计算结果/);
    expect(sheet(sheets, '无表头').headers).toEqual(['列A', '列B', '列C']);
    expect(sheet(sheets, '月度宽表').headers).toEqual(['Month', '2024-01', '2024-02', '2024-03', '2024-04']);
  });

  it('rejects encrypted workbooks with an actionable message', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    expect(() => parseFileBytes('secret.xlsx', ole)).toThrow(/取消密码/);
  });
});

describe('text fixtures', () => {
  it.each(['gbk_encoded.csv', 'utf8_bom.csv', 'utf16le_bom.csv'])('decodes %s', (name) => {
    const { sheets } = load(name);
    expect(sheets[0].headers).toEqual(['客户', '城市', '金额', '备注']);
    expect(sheets[0].rows[1]).toEqual(['李四', '上海', '980', '含,逗号']);
  });

  it('detects semicolons and keeps quoted delimiters and newlines', () => {
    const [s] = load('semicolon_quoted.csv').sheets;
    expect(s.headers).toEqual(['id', 'name', 'comment', 'amount']);
    expect(s.rows[0][1]).toBe('Smith; John');
    expect(s.rows[0][2]).toContain('said "hi"');
  });

  it('handles tsv, pipe text, ragged rows and missing headers', () => {
    expect(load('tab_separated.tsv').sheets[0].headers).toEqual(['sku', 'qty', 'price']);
    expect(load('pipe_delimited.txt').sheets[0].headers).toEqual(['code', 'label', 'value']);
    const ragged = load('ragged_rows.csv').sheets[0];
    expect(ragged.headers).toEqual(['a', 'b', 'c', '列D']);
    expect(ragged.rows).toHaveLength(3);
    expect(load('no_header.csv').sheets[0].rows).toHaveLength(3);
  });

  it('flattens nested JSON and finds wrapped record arrays', () => {
    const { sheets } = load('nested_wrapped.json');
    expect(sheets.map((s) => s.name)).toEqual(['customers', 'orders', '元信息']);
    const customers = sheet(sheets, 'customers');
    expect(customers.headers).toEqual(['id', 'name', 'address.city', 'address.zip', 'tags', 'active', 'note']);
    expect(customers.rows[0]).toEqual(['1', 'Acme', 'Berlin', '10115', 'vip, eu', 'true', '']);
  });

  it('reads JSON Lines, primitive arrays, plain objects and multi-document YAML', () => {
    expect(load('events.jsonl').sheets[0].headers).toEqual(['ts', 'event', 'user', 'page']);
    expect(load('primitives_array.json').sheets[0].rows).toHaveLength(5);
    expect(load('config_object.json').sheets[0].headers).toEqual(['name', 'version', 'flags.beta', 'ports']);
    const yaml = load('multi_doc.yaml').sheets[0];
    expect(yaml.headers).toEqual(['name', 'limits.cpu', 'limits.mem']);
    expect(yaml.rows).toHaveLength(2);
  });

  it('reports the position of JSON syntax errors', () => {
    expect(() => load('invalid.json')).toThrow(ImportError);
    expect(() => load('invalid.json')).toThrow(/第 1 行第 9 列/);
  });

  it('keeps XML attribute order, namespaces stripped, repeated children joined', () => {
    const { sheets } = load('namespaced_orders.xml');
    const orders = sheet(sheets, 'Order');
    expect(orders.headers).toEqual(['id', 'status', 'Customer', 'Total@currency', 'Total', 'Tag', 'Note']);
    expect(orders.rows[0][5]).toBe('vip, eu');
    expect(orders.rows[0][6]).toBe('Deliver <before> noon & call');
    expect(sheet(sheets, '元信息').rows).toContainEqual(['Orders@exported', '2024-06-01']);
  });

  it('decodes XML using its declared encoding', () => {
    const s = sheet(load('gbk_declared.xml').sheets, '人员');
    expect(s.headers).toEqual(['编号', '姓名', '部门']);
    expect(s.rows[1]).toEqual(['2', '李四', '市场']);
  });

  it('reports XML syntax errors with line and column', () => {
    expect(() => parseFileBytes('bad.xml', new TextEncoder().encode('<a><b></a>'))).toThrow(/第 1 行第 7 列/);
  });
});

describe('entry points', () => {
  it('rejects unsupported extensions and empty files', () => {
    expect(() => parseFileBytes('photo.png', new Uint8Array([1]))).toThrow(/不支持的文件类型/);
    expect(() => parseFileBytes('empty.csv', new Uint8Array())).toThrow(/为空/);
  });

  it('parses clipboard text copied from Excel', () => {
    const { file } = parseClipboardText('姓名\t金额\n张三\t1,200\n', 'clip.csv');
    expect(file.sheets[0].headers).toEqual(['姓名', '金额']);
    expect(file.sheets[0].rows).toEqual([['张三', '1,200']]);
  });

  it('accepts the desktop workbook payload', () => {
    const { file } = parseDesktopPayload('a.xlsx', {
      kind: 'workbook',
      workbook: { sheets: [raw([['A'], ['1']])], notices: ['x'], date1904: false },
    });
    expect(file.sheets[0].headers).toEqual(['A']);
  });

  it('decodes UTF-16 without BOM', () => {
    const bytes = new Uint8Array([0x61, 0, 0x2c, 0, 0x62, 0, 0x0a, 0, 0x31, 0, 0x2c, 0, 0x32, 0]);
    expect(decodeText(bytes)).toEqual({ text: 'a,b\n1,2', encoding: 'utf-16le' });
  });
});

describe.skipIf(!existsSync(REAL_DATA))('D:/tmp/excel real-world files', () => {
  const read = (name: string) => parseFileBytes(name, new Uint8Array(readFileSync(join(REAL_DATA, name))));

  it('reads the financial model without losing precision or headers', () => {
    const { file } = read('Financial_BP_Rolling_Forecast.xlsx');
    const summary = sheet(file.sheets, 'Summary');
    expect(summary.headers).toEqual(['Metric', '2024 Actual', '2025 Forecast', 'Change']);
    expect(summary.rows[0][1]).toBe('347826898.63');
    const revenue = sheet(file.sheets, 'Revenue Build');
    expect(revenue.headers.slice(0, 3)).toEqual(['Month', '2024-01', '2024-02']);
    // Stored as `<v>  Cloud Services</v>` without xml:space: Excel drops the indent, so do we.
    expect(revenue.rows.some((r) => r[0] === 'Cloud Services')).toBe(true);
    expect(sheet(file.sheets, 'Sales Detail').rows).toHaveLength(8640);
    expect(file.sheets.some((s) => s.name.startsWith('Assumptions · Opening Balance'))).toBe(true);
  });

  it('reads every XML record type in source column order', () => {
    const { file } = read('2024_budget_submission.xml');
    const fact = sheet(file.sheets, 'Fact');
    expect(fact.rows).toHaveLength(360);
    expect(fact.headers.slice(0, 3)).toEqual(['id', 'periodRef', 'entityRef']);
    expect(file.sheets.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Period', 'Metric', 'BusinessUnit', 'Entity', '元信息']),
    );
  });

  it.each(['gl_postings.csv', 'sales_detail.csv', 'headcount.csv', 'fixed_asset_register.csv', 'business_units.csv'])(
    'reads %s',
    (name) => {
      const { file } = read(name);
      expect(file.sheets[0].headers.length).toBeGreaterThan(5);
      expect(file.sheets[0].rows.length).toBeGreaterThan(4);
    },
  );
});
