# Run Excel's "Show Details" (PivotTable double-click) on every value cell of the pivots
# in cases.json and record which source rows it returns, so the app's drill-down can be
# checked row by row against Excel.
#
# Usage: pwsh -NoProfile -File scripts/excel-pivot-detail.ps1 <data.csv> <cases.json> <out.json>
# Cases use the format of excel-pivot-reference.ps1. The first column of the data must be a
# unique id; the output lists, per value cell (row / col offsets inside TableRange1,
# 0-based), the ids Excel shows in detail order. Kills only the Excel it started.
param(
  [Parameter(Mandatory = $true)][string]$Data,
  [Parameter(Mandatory = $true)][string]$Cases,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name User32D -MemberDefinition @'
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int processId);
'@
$aggCode = @{ sum = -4157; count = -4112; average = -4106; max = -4136; min = -4139 }
$excel = New-Object -ComObject Excel.Application
$excelPid = 0
$null = [Native.User32D]::GetWindowThreadProcessId([System.IntPtr]$excel.Hwnd, [ref]$excelPid)
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
    foreach ($f in $case.rows) { $pt.PivotFields($f).Orientation = 1 }
    foreach ($f in @($case.cols)) { if ($f) { $pt.PivotFields($f).Orientation = 2 } }
    if ($case.filter) {
      $pf = $pt.PivotFields($case.filter.field)
      $pf.Orientation = 3
      $pf.CurrentPage = [string]$case.filter.item
    }
    $null = $pt.AddDataField($pt.PivotFields($case.value), 'V', $aggCode[$case.agg])
    $pt.RowAxisLayout(1)
    $pt.RepeatAllLabels(2)
    foreach ($f in $case.rows) { $pt.PivotFields($f).Subtotals(1) = $false }
    $table = $pt.TableRange1
    $top = $table.Row; $left = $table.Column
    $cells = @()
    foreach ($cell in $pt.DataBodyRange.Cells) {
      $r = $cell.Row - $top; $c = $cell.Column - $left
      $ids = @()
      if ($null -ne $cell.Value2) {
        $cell.ShowDetail = $true
        $detail = $excel.ActiveSheet
        $used = $detail.UsedRange
        $n = $used.Rows.Count
        if ($n -gt 1) {
          $col = $detail.Range($detail.Cells(2, 1), $detail.Cells($n, 1)).Value2
          if ($n -eq 2) { $ids = @([string]$col) } else { for ($i = 1; $i -le $n - 1; $i++) { $ids += [string]$col[$i, 1] } }
        }
        $detail.Delete()
      }
      $cells += [pscustomobject]@{ r = $r; c = $c; ids = $ids }
    }
    $out += [pscustomobject]@{ name = $case.name; cells = $cells }
    "$($case.name): $($cells.Count) cells"
  }
  $wb.Close($false)
  $out | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $OutFile -Encoding utf8NoBOM
  "wrote $OutFile"
} finally {
  try { $excel.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  if ($excelPid -gt 0) { Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue }
}
