# Let desktop Excel compute =a+b, =a-b, =a*b, =a/b for every row of a CSV and run its
# AutoFilter with the given criteria, so the app's computed columns and row filters can be
# checked against Excel row by row.
#
# Usage: pwsh -NoProfile -File scripts/excel-ops-reference.ps1 <data.csv> <filters.json> <out.json>
#   data.csv: columns id, a, b, d (id is a unique row id).
#   filters.json: [{ "name": "...", "column": "a", "criteria": ">100" }]
# Output: { "calc": [{ "id": 0, "add": "...", "sub": "...", "mul": "...", "div": "..." }],
#           "filters": [{ "name": "...", "kept": [ids] }] }
# Numbers are written with "R" (round-trip), errors as Excel shows them (#VALUE!).
# Opens no user files and kills only the Excel it started.
param(
  [Parameter(Mandatory = $true)][string]$Data,
  [Parameter(Mandatory = $true)][string]$Filters,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name User32O -MemberDefinition @'
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int processId);
'@
$inv = [System.Globalization.CultureInfo]::InvariantCulture
$excel = New-Object -ComObject Excel.Application
$excelPid = 0
$null = [Native.User32O]::GetWindowThreadProcessId([System.IntPtr]$excel.Hwnd, [ref]$excelPid)
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  # UTF-8, delimited, comma only.
  $excel.Workbooks.OpenText((Resolve-Path $Data).Path, 65001, 1, 1, 1, $false, $false, $false, $true)
  $wb = $excel.ActiveWorkbook
  $ws = $wb.Worksheets.Item(1)
  $n = $ws.UsedRange.Rows.Count
  $ws.Range("E2:E$n").Formula = '=B2+C2'
  $ws.Range("F2:F$n").Formula = '=B2-C2'
  $ws.Range("G2:G$n").Formula = '=B2*C2'
  $ws.Range("H2:H$n").Formula = '=B2/C2'
  $excel.Calculate()
  $cell = {
    param($r, $c)
    $v = $ws.Cells.Item($r, $c).Value2
    if ($v -is [double]) { $v.ToString('R', $inv) } elseif ($v -is [int]) { [string]$ws.Cells.Item($r, $c).Text } elseif ($null -eq $v) { '' } else { [string]$v }
  }
  $calc = @()
  for ($r = 2; $r -le $n; $r++) {
    $calc += [pscustomobject]@{
      id = [int]$ws.Cells.Item($r, 1).Value2
      add = & $cell $r 5; sub = & $cell $r 6; mul = & $cell $r 7; div = & $cell $r 8
    }
  }
  $ws.Range("E:H").ClearContents() | Out-Null
  $colOf = @{ a = 2; b = 3; d = 4 }
  $out = @()
  $range = $ws.Range("A1:D$n")
  foreach ($f in (Get-Content -Raw -Encoding utf8 $Filters | ConvertFrom-Json)) {
    $range.AutoFilter($colOf[$f.column], $f.criteria) | Out-Null
    $ids = @()
    for ($r = 2; $r -le $n; $r++) {
      if (-not $ws.Rows.Item($r).Hidden) { $ids += [int]$ws.Cells.Item($r, 1).Value2 }
    }
    $ws.AutoFilterMode = $false
    $out += [pscustomobject]@{ name = $f.name; kept = $ids }
  }
  $wb.Close($false)
  [pscustomobject]@{ calc = $calc; filters = $out } | ConvertTo-Json -Depth 5 -Compress | Set-Content -Path $OutFile -Encoding utf8NoBOM
  "wrote $OutFile ($($calc.Count) rows, $($out.Count) filters)"
} finally {
  try { $excel.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  if ($excelPid -gt 0) { Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue }
}
