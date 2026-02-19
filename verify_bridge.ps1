$response = Invoke-RestMethod -Uri "http://localhost:3000/v1/models" -Method Get
Write-Host "Models Response:"
$response | ConvertTo-Json -Depth 5

$chatBody = @{
    model = "gemini-2.5-flash-lite"
    messages = @(
        @{ role = "user"; content = "Hello" }
    )
}
$chatResponse = Invoke-RestMethod -Uri "http://localhost:3000/v1/chat/completions" -Method Post -Body ($chatBody | ConvertTo-Json) -ContentType "application/json"
Write-Host "Chat Response:"
$chatResponse | ConvertTo-Json -Depth 5
