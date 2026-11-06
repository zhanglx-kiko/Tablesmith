# Build PivotTables with desktop Excel's own engine and dump every result cell, so the
# app's pivot can be checked cell by cell against Excel.
#
# Usage: pwsh -NoProfile -File scripts/excel-pivot-reference.ps1 <data.csv> <cases.json> <out.json>
#   cases.json: [{ "name": "...", "rows": ["region"], "cols": ["period_id"], "value": "units",
#                  "agg": "sum|count|average|max|min", "filter": { "field": "...", "item": "..." } }]
# Excel reads the CSV with its own type detection, so the data is what a user who opens
# the CSV in Excel would pivot. Opens no user files and kills only the Excel it started.
param(
  [Parameter(Mandatory = $true)][string]$Data,
  [Parameter(Mandatory = $true)][string]$Cases,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name User32P -MemberDefinition @'
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int processId);
'@
$aggCode = @{ sum = -4157; count = -4112; average = -4106; max = -4136; min = -4139 }
$excel = New-Object -ComObject Excel.Application
$excelPid = 0
$null = [Native.User32P]::GetWindowThreadProcessId([System.IntPtr]$excel.Hwnd, [ref]$excelPid)
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Open((Resolve-Path $Data).Path)
  $src = $wb.Worksheets.Item(1)
  $range = $src.UsedRange
  $out = @()
  foreach ($case in (Get-Content -Raw -Encoding utf8 $Cases | ConvertFrom-Json)) {
    $ws = $wb.Worksheets.Add()
    $cache = $wb.PivotCaches().Create(1, $range)   # xlDatabase
    $pt = $cache.CreatePivotTable($ws.Range('A3'), 'P')
    foreach ($f in $case.rows) { $pt.PivotFields($f).Orientation = 1 }   # xlRowField
    foreach ($f in @($case.cols)) { if ($f) { $pt.PivotFields($f).Orientation = 2 } }   # xlColumnField
    if ($case.filter) {
      $pf = $pt.PivotFields($case.filter.field)
      $pf.Orientation = 3   # xlPageField
      $pf.CurrentPage = [string]$case.filter.item
    }
    $df = $pt.AddDataField($pt.PivotFields($case.value), 'V', $aggCode[$case.agg])
    if ($case.calc) { $df.Calculation = [int]$case.calc }
    $pt.RowAxisLayout(1)   # xlTabularRow: one column per row field, labels repeated
    $pt.RepeatAllLabels(2) # xlRepeatLabels
    foreach ($f in $case.rows) { $pt.PivotFields($f).Subtotals(1) = $false }
    $body = $pt.TableRange1
    $vals = $body.Value2
    $rowsN = $body.Rows.Count; $colsN = $body.Columns.Count
    $grid = @()
    for ($r = 1; $r -le $rowsN; $r++) {
      $line = @()
      for ($c = 1; $c -le $colsN; $c++) {
        $v = if ($rowsN -eq 1 -and $colsN -eq 1) { $vals } else { $vals[$r, $c] }
        $line += if ($v -is [double]) { $v.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture) } elseif ($null -eq $v) { '' } else { [string]$v }
      }
      $grid += ,$line
    }
    $out += [pscustomobject]@{ name = $case.name; grid = $grid }
  }
  $wb.Close($false)
  $out | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $OutFile -Encoding utf8NoBOM
  "wrote $OutFile ($($out.Count) pivots)"
} finally {
  try { $excel.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  if ($excelPid -gt 0) { Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue }
}
