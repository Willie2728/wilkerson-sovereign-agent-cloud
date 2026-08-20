param(
    [Parameter(Mandatory = $true)][string]$TextPath,
    [Parameter(Mandatory = $true)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$text = Get-Content -LiteralPath $TextPath -Raw -Encoding UTF8
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    try {
        $speaker.SelectVoice('Microsoft David Desktop')
    } catch {
        $speaker.SelectVoiceByHints(
            [System.Speech.Synthesis.VoiceGender]::Male,
            [System.Speech.Synthesis.VoiceAge]::Adult,
            0,
            [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
        )
    }
    Write-Output "Voice=$($speaker.Voice.Name); Culture=$($speaker.Voice.Culture.Name); Gender=$($speaker.Voice.Gender)"
    $speaker.Rate = -1
    $speaker.Volume = 100
    $speaker.SetOutputToWaveFile($OutputPath)
    $speaker.Speak($text)
} finally {
    $speaker.Dispose()
}
