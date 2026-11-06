# Dump what real Excel displays (Range.Text) and stores (Range.Value2) for every used cell,
# so the importer's display formatting can be checked cell by cell against Excel itself.
#
# Usage: pwsh -NoProfile -File scripts/excel-reference.ps1 <workbook> <out.json>
# Needs desktop Excel. Opens the file read-only, never saves, and always kills the Excel
# process it started (matched by PID), never one the user opened.
param(
  [Parameter(Mandatory = $true)][string]$Workbook,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace Native -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int pid);'

$excel = New-Object -ComObject Excel.Application
$excelPid = 0
$null = [Native.User32]::GetWindowThreadProcessId([System.IntPtr]$excel.Hwnd, [ref]$excelPid)
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.ScreenUpdating = $false
try {
  # Manual calculation: report the values stored in the file, not Excel's recalculation
  # (a SUM recomputed on open can differ in the last binary digits from the cached result).
  # Calculation can only be set once a workbook is open, so open a blank one first.
  $null = $excel.Workbooks.Add()
  $excel.Calculation = -4135   # xlCalculationManual
  $excel.CalculateBeforeSave = $false
  $wb = $excel.Workbooks.Open((Resolve-Path $Workbook).Path, 0, $true)
  $sheets = @()
  foreach ($ws in $wb.Worksheets) {
    $used = $ws.UsedRange
    # Widen columns so Range.Text never returns "####" for a too-narrow column.
    $null = $used.Columns.AutoFit()
    $r0 = $used.Row; $c0 = $used.Column
    $rows = $used.Rows.Count; $cols = $used.Columns.Count
    $values = $used.Value2          # one COM call for the whole block
    $cells = [System.Collections.Generic.List[object]]::new()
    for ($c = 1; $c -le $cols; $c++) {
      $column = $used.Columns.Item($c)
      for ($r = 1; $r -le $rows; $r++) {
        $v = if ($rows -eq 1 -and $cols -eq 1) { $values } else { $values[$r, $c] }
        if ($null -eq $v) { continue }
        $cell = $column.Cells.Item($r)
        # Doubles in round-trip form ("R"): [string] keeps only 15 digits, which would hide
        # precision loss in the raw-value test. `type` separates the text "00892" from 892.
        $type = if ($v -is [double]) { 'n' } elseif ($v -is [bool]) { 'b' } elseif ($v -is [int]) { 'e' } else { 's' }
        $value = if ($v -is [double]) { $v.ToString('R', [System.Globalization.CultureInfo]::InvariantCulture) } else { [string]$v }
        $cells.Add([pscustomobject]@{
          r = $r0 + $r - 2; c = $c0 + $c - 2
          text = [string]$cell.Text
          value = $value
          type = $type
          format = [string]$cell.NumberFormat
        })
      }
    }
    $sheets += [pscustomobject]@{ name = $ws.Name; cells = $cells }
  }
  $wb.Close($false)
  [pscustomobject]@{ file = (Split-Path $Workbook -Leaf); sheets = $sheets } |
    ConvertTo-Json -Depth 5 -Compress |
    Set-Content -Path $OutFile -Encoding utf8NoBOM
  "wrote $OutFile"
} finally {
  try { $excel.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  if ($excelPid -gt 0) { Stop-Process -Id $excelPid -Force -ErrorAction SilentlyContinue }
}
