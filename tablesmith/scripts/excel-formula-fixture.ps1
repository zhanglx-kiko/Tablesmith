# Build sample-data/edge-cases/formulas.{xlsx,xls,xlsb} with desktop Excel, and write
# sample-data/excel-reference/formulas.json: every cell's formula as Excel reports it
# (Range.Formula, English function names) and its calculated value, so the importer's
# formula text can be checked cell by cell in all three formats.
#
# The sheet mixes what real reports hold: plain references, absolute and mixed
# references, cross-sheet references with quoted names, shared formulas filled down, a
# column where some rows are typed numbers instead of formulas, text and error results,
# string literals with quotes, IF / SUMIFS / VLOOKUP, a formula whose result is empty
# text, a legacy array formula and a formula in the header row.
#
# Usage: pwsh -NoProfile -File scripts/excel-formula-fixture.ps1
# Opens no user files and kills only the Excel it started.
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name User32F -MemberDefinition @'
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int processId);
'@
$root = Split-Path -Parent $PSScriptRoot
$edge = Join-Path $root 'sample-data/edge-cases'
$refOut = Join-Path $root 'sample-data/excel-reference/formulas.json'
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$excel = New-Object -ComObject Excel.Application
$excelPid = 0
$null = [Native.User32F]::GetWindowThreadProcessId([System.IntPtr]$excel.Hwnd, [ref]$excelPid)
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 2) { $null = $wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $rates = $wb.Worksheets.Item(2)
  $rates.Name = "Rate's & FX"
  $rates.Range('A1:B1').Value2 = [object[]]@('code', 'rate')
  $rates.Range('A2:B4').Value2 = [object[,]]::new(3, 2)
  $codes = @('CNY', 'USD', 'EUR'); $vals = @(1, 7.1, 7.8)
  for ($i = 0; $i -lt 3; $i++) { $rates.Cells.Item($i + 2, 1).Value2 = $codes[$i]; $rates.Cells.Item($i + 2, 2).Value2 = $vals[$i] }

  $ws = $wb.Worksheets.Item(1)
  $ws.Name = '订单'
  $head = @('id', 'qty', 'price', 'amount', 'currency', 'amount_cny', 'share', 'flag', 'note', 'check')
  for ($c = 0; $c -lt $head.Count; $c++) { $ws.Cells.Item(1, $c + 1).Value2 = $head[$c] }
  $cur = @('CNY', 'USD', 'EUR', 'USD', 'XXX', 'CNY', 'EUR', 'USD', 'CNY', 'USD')
  for ($r = 2; $r -le 11; $r++) {
    $ws.Cells.Item($r, 1).Value2 = "A-$($r - 1)"
    $ws.Cells.Item($r, 2).Value2 = ($r * 3) % 7
    $ws.Cells.Item($r, 3).Value2 = 9.95 * ($r - 1)
    $ws.Cells.Item($r, 5).Value2 = $cur[$r - 2]
  }
  # Shared formula filled down, then two rows overwritten by typed numbers.
  $ws.Range('D2:D11').Formula = '=B2*C2'
  $ws.Range('D5').Value2 = 123.45
  $ws.Range('D9').Value2 = 0
  $ws.Range('F2:F11').Formula = "=IFERROR(D2*VLOOKUP(E2,'Rate''s & FX'!`$A`$2:`$B`$4,2,FALSE),`"no rate`")"
  $ws.Range('G2:G11').Formula = '=D2/SUM($D$2:$D$11)'
  $ws.Range('H2:H11').Formula = '=IF(B2=0,"zero ""qty""",IF(B2>3,TRUE,FALSE))'
  $ws.Range('I2').Formula = '=""'
  $ws.Range('I3').Formula = '=1/0'
  $ws.Range('I4').Formula = '=A3&" / "&E3'
  $ws.Range('I5').Formula = '=SUMIFS(D$2:D$11,E$2:E$11,"USD")'
  $ws.Range('I6').Value2 = 'typed text'
  $ws.Range('J2:J11').Formula = '=ROUND(F2,2)=F2'
  # Legacy array formula over three cells (each cell reports the same formula text), and
  # a formula in the header row (headers keep their text, not the formula).
  $ws.Range('K2:K4').FormulaArray = '=B2:B4*2'
  $ws.Cells.Item(1, 11).Formula = '="dbl"&"_qty"'
  $excel.Calculate()

  $cells = @()
  foreach ($sheet in @($ws, $rates)) {
    $used = $sheet.UsedRange
    for ($r = 1; $r -le $used.Rows.Count; $r++) {
      for ($c = 1; $c -le $used.Columns.Count; $c++) {
        $cell = $sheet.Cells.Item($r, $c)
        if (-not $cell.HasFormula) { continue }
        $array = [bool]$cell.HasArray
        $v = $cell.Value2
        $value = if ($v -is [double]) { $v.ToString('R', $inv) } elseif ($v -is [int]) { $cell.Text } elseif ($null -eq $v) { '' } else { [string]$v }
        $cells += [pscustomobject]@{ sheet = $sheet.Name; row = $r - 1; col = $c - 1; formula = $cell.Formula.Substring(1); array = $array; value = $value }
      }
    }
  }
  # xlOpenXMLWorkbook 51, xlExcel8 56, xlExcel12 50
  foreach ($fmt in @(@('xlsx', 51), @('xls', 56), @('xlsb', 50))) {
    $wb.SaveAs((Join-Path $edge "formulas.$($fmt[0])"), $fmt[1])
  }
  $wb.Close($false)
  $cells | ConvertTo-Json -Depth 4 | Set-Content -Path $refOut -Encoding utf8NoBOM
  "wrote formulas.{xlsx,xls,xlsb} and $refOut ($($cells.Count) formula cells)"
} finally {
  try { $excel.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  if ($excelPid -gt 0) { Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue }
}
