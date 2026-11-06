# Run desktop Excel's own Remove Duplicates (Data > Remove Duplicates) on a CSV and dump
# the rows Excel keeps, so the app's dedupe can be checked against Excel row by row.
#
# Usage: pwsh -NoProfile -File scripts/excel-dedupe-reference.ps1 <data.csv> <out.json> [keyColumn ...]
#   keyColumn: 1-based column numbers to compare; all columns when omitted.
# Output: { "kept": [ <0-based data row index in the CSV>, ... ] }. Column A of the CSV
# must be a unique row id (the script maps kept rows back by it), and is not compared.
# Opens no user files and kills only the Excel it started.
param(
  [Parameter(Mandatory = $true)][string]$Data,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int[]]$Keys
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name User32D -MemberDefinition @'
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int processId);
'@
$excel = New-Object -ComObject Excel.Application
$excelPid = 0
$null = [Native.User32D]::GetWindowThreadProcessId([System.IntPtr]$excel.Hwnd, [ref]$excelPid)
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  # OpenText with code page 65001 reads the CSV as UTF-8 (Open would use the ANSI code
  # page and garble Chinese text). Delimited, comma only, general column types.
  $excel.Workbooks.OpenText((Resolve-Path $Data).Path, 65001, 1, 1, 1, $false, $false, $false, $true)
  $wb = $excel.ActiveWorkbook
  $ws = $wb.Worksheets.Item(1)
  $range = $ws.UsedRange
  $cols = $range.Columns.Count
  $cmp = if ($Keys) { $Keys } else { 2..$cols }
  # xlYes = 1: the first row is the header.
  $range.RemoveDuplicates([object[]]$cmp, 1)
  $used = $ws.UsedRange
  $ids = @()
  for ($r = 2; $r -le $used.Rows.Count; $r++) {
    $v = $ws.Cells.Item($r, 1).Value2
    if ($null -ne $v) { $ids += [int]$v }
  }
  $wb.Close($false)
  [pscustomobject]@{ kept = $ids } | ConvertTo-Json -Compress | Set-Content -Path $OutFile -Encoding utf8NoBOM
  "wrote $OutFile ($($ids.Count) rows kept)"
} finally {
  try { $excel.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  if ($excelPid -gt 0) { Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue }
}
