#!/bin/bash
watch -n 1 '
echo "=== HOST ==="
printf "CPU: %s%%\n" "$(vmstat 1 2 | tail -1 | awk "{print 100-\$15}")"
printf "MEM: %s\n" "$(free -h | awk "/Mem:/ {printf \"%s / %s (%.1f%%)\", \$3, \$2, \$3/\$2*100}")"
echo ""
echo "=== DOCKER: music-bot ==="
docker stats music-bot --no-stream --format "CPU: {{.CPUPerc}}\nMEM: {{.MemUsage}} ({{.MemPerc}})\nNET: {{.NetIO}}"
'
