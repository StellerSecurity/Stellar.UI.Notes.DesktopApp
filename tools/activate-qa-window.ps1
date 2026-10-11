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
# Use normal Windows application activation; no input-policy/registry changes.
$desktop = New-Object -ComObject WScript.Shell
try {
    if (!$desktop.AppActivate($TargetProcessId)) { throw 'Windows could not activate the QA process' }
} finally {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($desktop)
}
