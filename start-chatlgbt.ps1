# Prompts locally without putting the key into command history or a project file.
$previousApiKey = $env:OPENAI_API_KEY
$secureApiKey = Read-Host 'OpenAI API key (hidden)' -AsSecureString
$apiKeyPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureApiKey)
try {
    $env:OPENAI_API_KEY = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($apiKeyPointer)
} finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($apiKeyPointer)
    $secureApiKey.Dispose()
}
Push-Location $PSScriptRoot
try {
    Write-Host 'Starting BlueGay with ChatLGBT. Open http://127.0.0.1:4173 and click the sparkle icon.'
    & node serve.mjs
} finally {
    $env:OPENAI_API_KEY = $previousApiKey
    Pop-Location
}
