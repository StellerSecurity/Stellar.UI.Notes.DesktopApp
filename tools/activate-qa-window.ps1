param(
    [Parameter(Mandatory = $true)][int]$TargetProcessId,
    [Parameter(Mandatory = $true)][string]$ExpectedExecutable
)
$ErrorActionPreference = 'Stop'
if ($env:TF_BUILD -ne 'True' -or !$env:AGENT_TEMPDIRECTORY) {
    throw 'Window activation is restricted to the isolated Azure test agent'
}
$allowed = [IO.Path]::GetFullPath((Join-Path $env:AGENT_TEMPDIRECTORY 'qa-installed/Stellar Notes.exe'))
if ([IO.Path]::GetFullPath($ExpectedExecutable) -ne $allowed) {
    throw 'Unexpected QA executable path'
}
$target = Get-Process -Id $TargetProcessId
if ($target.Path -ne $allowed) { throw 'QA process identity mismatch' }
# Change only this disposable QA window's Z order. A covered Electron window
# can have keyboard focus while Chromium still considers it occluded.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class QaWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
}
'@
$handle = $target.MainWindowHandle
if ($handle -eq [IntPtr]::Zero) { throw 'QA process has no main window' }
[void][QaWindow]::ShowWindow($handle, 9)
# HWND_TOPMOST, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW.
# Both QA windows are destroyed at the end of the job; no persistent setting.
if (![QaWindow]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, 0x43)) {
    throw 'Could not raise the QA window'
}
if (![QaWindow]::IsWindowVisible($handle) -or [QaWindow]::IsIconic($handle)) {
    throw 'QA window is not restored and visible'
}
# Normal Windows activation; no input-policy/registry changes.
$desktop = New-Object -ComObject WScript.Shell
try {
    if (!$desktop.AppActivate($TargetProcessId)) { throw 'Windows could not activate the QA process' }
} finally {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($desktop)
}
