$ErrorActionPreference = 'SilentlyContinue'
$root = Join-Path $env:USERPROFILE '.claude\projects'
$last = @{}   # message.id|requestId -> record (last chunk wins: usage is cumulative)
$sess = @{}
$hours = New-Object 'int[]' 24
foreach ($f in Get-ChildItem $root -Recurse -Filter *.jsonl) {
  foreach ($line in [IO.File]::ReadLines($f.FullName)) {
    if ($line.IndexOf('"usage"') -lt 0 -or $line.IndexOf('"type":"assistant"') -lt 0) { continue }
    try { $o = $line | ConvertFrom-Json } catch { continue }
    $m = $o.message
    if (-not $m -or -not $m.usage -or -not $m.model -or $m.model -eq '<synthetic>') { continue }
    $ts = [regex]::Match($line, '"timestamp":"([^"]+)"').Groups[1].Value
    if (-not $ts) { continue }
    $dt = [DateTimeOffset]::Parse($ts, [Globalization.CultureInfo]::InvariantCulture).LocalDateTime
    $proj = if ($o.cwd) { Split-Path $o.cwd -Leaf } else { $f.Directory.Name }
    $key = "$($m.id)|$($o.requestId)"
    $sid = if ($o.sessionId) { $o.sessionId } else { $f.BaseName }
    $last[$key] = @{ sid = $sid; day = $dt.ToString('yyyy-MM-dd'); project = $proj; model = $m.model
      input = [long]$m.usage.input_tokens; output = [long]$m.usage.output_tokens
      cw = [long]$m.usage.cache_creation_input_tokens; cr = [long]$m.usage.cache_read_input_tokens; hour = $dt.Hour }
    if (-not $sess.ContainsKey($sid) -or $dt -lt $sess[$sid].dt) { $sess[$sid] = @{ dt = $dt; project = $proj } }
  }
}
$agg = @{}
foreach ($r in $last.Values) {
  $k = "$($r.day)|$($r.sid)|$($r.project)|$($r.model)"
  if (-not $agg.ContainsKey($k)) { $agg[$k] = @{ sid=$r.sid; day=$r.day; project=$r.project; model=$r.model; input=0L; output=0L; cw=0L; cr=0L; n=0 } }
  $a = $agg[$k]; $a.input += $r.input; $a.output += $r.output; $a.cw += $r.cw; $a.cr += $r.cr; $a.n++
}
foreach ($s in $sess.Values) { $hours[$s.dt.Hour]++ }
$out = @{
  rows = @($agg.Values)
  sessions = @($sess.GetEnumerator() | ForEach-Object { @{ id = $_.Key; start = $_.Value.dt.ToString('yyyy-MM-ddTHH:mm'); project = $_.Value.project } })
  hours = $hours
  generated = (Get-Date).ToString('yyyy-MM-dd HH:mm')
}
$out | ConvertTo-Json -Depth 5 -Compress
