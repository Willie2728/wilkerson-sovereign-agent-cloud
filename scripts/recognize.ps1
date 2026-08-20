param(
    [Parameter(Mandatory = $true)][string]$InputPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$culture = [System.Globalization.CultureInfo]::GetCultureInfo('en-US')
$recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::new($culture)
try {
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $recognizer.SetInputToWaveFile($InputPath)
    $parts = New-Object System.Collections.Generic.List[string]
    $confidences = New-Object System.Collections.Generic.List[double]
    while ($true) {
        $result = $recognizer.Recognize([TimeSpan]::FromSeconds(20))
        if ($null -eq $result) { break }
        if (-not [string]::IsNullOrWhiteSpace($result.Text)) {
            $parts.Add($result.Text)
            $confidences.Add($result.Confidence)
        }
    }
    $confidence = if ($confidences.Count) { ($confidences | Measure-Object -Average).Average } else { 0 }
    [pscustomobject]@{
        text = ($parts -join ' ').Trim()
        confidence = [math]::Round($confidence, 3)
        engine = 'Microsoft Speech Recognizer 8.0'
        culture = 'en-US'
    } | ConvertTo-Json -Compress
} finally {
    $recognizer.Dispose()
}
