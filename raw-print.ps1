param([ValidateSet('Print','DryRun')][string]$Mode = 'DryRun', [string]$PrinterName = 'M860 USB Text Test')
$ErrorActionPreference = 'Stop'
$jobStarted = $false
try {
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $chunks = @($inputData.chunks | ForEach-Object { ,[Convert]::FromBase64String($_) })
  if ($chunks.Count -lt 3 -or $chunks.Count -gt 41) { throw 'Invalid chunk count.' }
  if ([BitConverter]::ToString($chunks[0]) -ne '1B-40-1B-61-00-1B-4A-20') { throw 'Invalid receipt prefix.' }
  if ([BitConverter]::ToString($chunks[-1]) -ne '1B-4A-40') { throw 'Invalid receipt suffix.' }
  $total = 0
  foreach($chunk in $chunks) { $total += $chunk.Length }
  for ($i=1; $i -lt $chunks.Count-1; $i++) {
    $chunk = $chunks[$i]
    if ($chunk.Length -lt 8 -or [BitConverter]::ToString($chunk[0..5]) -ne '1D-76-30-00-3B-00') { throw 'Invalid raster header.' }
    $rows = [int]$chunk[6] + 256 * [int]$chunk[7]
    if ($rows -lt 1 -or $rows -gt 64 -or $chunk.Length -ne (8+59*$rows)) { throw 'Invalid raster block.' }
  }
  if ($Mode -eq 'DryRun') {
    @{ok=$true; dryRun=$true; chunks=$chunks.Count; bytes=$total; printerOpened=$false} | ConvertTo-Json -Compress
    exit 0
  }
  if ($PrinterName -ne 'M860 USB Text Test') { throw 'Only the configured ESC/POS test queue is supported.' }
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SampleReceiptSpool {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
 public struct DOC_INFO_1 { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype; }
 [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr printer, IntPtr defaults);
 [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr printer, int level, ref DOC_INFO_1 info);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr printer);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr printer);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr printer);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool AbortPrinter(IntPtr printer);
 [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr printer);
}
"@
  $handle=[IntPtr]::Zero
  $completed=$false
  try {
    if (-not [SampleReceiptSpool]::OpenPrinter($PrinterName,[ref]$handle,[IntPtr]::Zero)) { throw "Cannot open printer (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
    $doc=New-Object SampleReceiptSpool+DOC_INFO_1
    $doc.pDatatype='RAW'
    $job=[SampleReceiptSpool]::StartDocPrinter($handle,1,[ref]$doc)
    if ($job -le 0) { throw "Cannot start print job (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))." }
    $jobStarted=$true
    if (-not [SampleReceiptSpool]::StartPagePrinter($handle)) { throw 'Cannot start receipt page.' }
    foreach($chunk in $chunks) {
      $written=0
      if (-not [SampleReceiptSpool]::WritePrinter($handle,$chunk,$chunk.Length,[ref]$written) -or $written -ne $chunk.Length) { throw 'Printer did not accept the full receipt block.' }
      Start-Sleep -Milliseconds 150
    }
    if (-not [SampleReceiptSpool]::EndPagePrinter($handle)) { throw 'Cannot finish receipt page.' }
    if (-not [SampleReceiptSpool]::EndDocPrinter($handle)) { throw 'Cannot finish print job.' }
    $completed=$true
    @{ok=$true; jobId=$job; bytes=$total; printer=$PrinterName; submitted=$true} | ConvertTo-Json -Compress
  } finally {
    if ($handle -ne [IntPtr]::Zero) {
      if ($jobStarted -and -not $completed) { [void][SampleReceiptSpool]::AbortPrinter($handle) }
      [void][SampleReceiptSpool]::ClosePrinter($handle)
    }
  }
} catch {
  @{ok=$false; message=$_.Exception.Message; outcomeUncertain=$jobStarted} | ConvertTo-Json -Compress
  exit 1
}
